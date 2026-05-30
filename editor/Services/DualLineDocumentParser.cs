using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using editor.Models;

namespace editor.Services;

public sealed class DualLineDocumentParser
{
    private readonly record struct LineSnapshot(int LineNumber, string Text, string TrimmedText, int StartOffset);

    public ParsedDocument Parse(string text, ParserConfig config, bool enableEditRestriction)
    {
        if (!enableEditRestriction)
        {
            return new ParsedDocument(false);
        }

        var normalizedConfig = config.Clone();
        normalizedConfig.Normalize();

        if (!TryCreateRegexes(normalizedConfig, out var originalRegex, out var translatedRegex, out var nameRegex, out _))
        {
            return new ParsedDocument(false);
        }

        var lines = SplitLines(text);
        var lineInfos = new Dictionary<int, ParsedLineInfo>();
        var editableSegments = new List<EditableSegment>();

        MatchedGroups? pendingOriginal = null;
        var pendingOriginalLineNumber = -1;

        foreach (var line in lines)
        {
            if (nameRegex is not null)
            {
                var nameMatch = TryMatchName(nameRegex, line.TrimmedText);
                if (nameMatch is not null)
                {
                    lineInfos[line.LineNumber] = BuildLineInfo(line.LineNumber, ParsedLineKind.Other, new MatchedGroups { Prefix = string.Empty, White = string.Empty, Text = line.TrimmedText, Suffix = string.Empty }, line.StartOffset, nameMatch);
                    pendingOriginal = null;
                    pendingOriginalLineNumber = -1;
                    continue;
                }
            }

            var originalGroups = TryMatch(originalRegex!, line.TrimmedText);
            if (originalGroups is not null)
            {
                lineInfos[line.LineNumber] = BuildLineInfo(line.LineNumber, ParsedLineKind.Original, originalGroups, line.StartOffset);
                pendingOriginal = originalGroups.Clone();
                pendingOriginalLineNumber = line.LineNumber;
                continue;
            }

            var translatedGroups = TryMatch(translatedRegex!, line.TrimmedText);
            if (translatedGroups is not null)
            {
                if (pendingOriginal is not null && pendingOriginalLineNumber >= 0)
                {
                    var adjustedOriginal = pendingOriginal.Clone();
                    var adjustedTranslated = translatedGroups.Clone();
                    Adjust(adjustedOriginal, adjustedTranslated);
                    lineInfos[pendingOriginalLineNumber] = BuildLineInfo(
                        pendingOriginalLineNumber,
                        ParsedLineKind.Original,
                        adjustedOriginal,
                        lines[pendingOriginalLineNumber].StartOffset);
                    lineInfos[line.LineNumber] = BuildLineInfo(line.LineNumber, ParsedLineKind.Translated, adjustedTranslated, line.StartOffset);
                    editableSegments.Add(BuildEditableSegment(line.StartOffset, adjustedTranslated));
                    pendingOriginal = null;
                    pendingOriginalLineNumber = -1;
                }
                else
                {
                    lineInfos[line.LineNumber] = BuildLineInfo(line.LineNumber, ParsedLineKind.Translated, translatedGroups, line.StartOffset);
                    editableSegments.Add(BuildEditableSegment(line.StartOffset, translatedGroups));
                }

                continue;
            }

            editableSegments.Add(new EditableSegment(line.StartOffset, line.Text.Length));

            pendingOriginal = null;
            pendingOriginalLineNumber = -1;
        }

        return new ParsedDocument(
            true,
            lineInfos.Values.OrderBy(line => line.LineNumber).ToList(),
            editableSegments.OrderBy(segment => segment.StartOffset).ToList());
    }

    public static bool TryValidate(ParserConfig config, out string? error)
    {
        var normalizedConfig = config.Clone();
        normalizedConfig.Normalize();

        if (string.IsNullOrWhiteSpace(normalizedConfig.OriginalPrefixRegex)
            && string.IsNullOrWhiteSpace(normalizedConfig.TranslatedPrefixRegex))
        {
            error = null;
            return true;
        }

        if (string.IsNullOrWhiteSpace(normalizedConfig.OriginalPrefixRegex)
            || string.IsNullOrWhiteSpace(normalizedConfig.TranslatedPrefixRegex))
        {
            error = "原文和译文前缀正则需要同时设置；都留空表示关闭双行限制。";
            return false;
        }

        return TryCreateRegexes(normalizedConfig, out _, out _, out _, out error);
    }

    private static EditableSegment BuildEditableSegment(int lineStartOffset, MatchedGroups groups)
    {
        return new EditableSegment(lineStartOffset + groups.Prefix.Length + groups.White.Length, groups.Text.Length);
    }

    private static ParsedLineInfo BuildLineInfo(int lineNumber, ParsedLineKind kind, MatchedGroups groups, int lineStartOffset, string? name = null)
    {
        return new ParsedLineInfo
        {
            LineNumber = lineNumber,
            Kind = kind,
            EditableStartOffset = kind == ParsedLineKind.Translated
                ? lineStartOffset + groups.Prefix.Length + groups.White.Length
                : lineStartOffset,
            EditableLength = kind == ParsedLineKind.Translated ? groups.Text.Length : 0,
            PrefixLength = groups.Prefix.Length + groups.White.Length,
            Name = name ?? string.Empty,
        };
    }

    private static bool TryCreateRegexes(
        ParserConfig config,
        out Regex? originalRegex,
        out Regex? translatedRegex,
        out Regex? nameRegex,
        out string? error)
    {
        originalRegex = null;
        translatedRegex = null;
        nameRegex = null;

        if (string.IsNullOrWhiteSpace(config.OriginalPrefixRegex)
            && string.IsNullOrWhiteSpace(config.TranslatedPrefixRegex)
            && string.IsNullOrWhiteSpace(config.NameRegex))
        {
            error = null;
            return false;
        }

        if (string.IsNullOrWhiteSpace(config.OriginalPrefixRegex)
            || string.IsNullOrWhiteSpace(config.TranslatedPrefixRegex))
        {
            error = "原文和译文前缀正则需要同时设置。";
            return false;
        }

        try
        {
            originalRegex = new Regex(
                $"^(?<prefix>{config.OriginalPrefixRegex})(?<white>{config.OriginalWhiteRegex})(?<text>.*?)(?<suffix>{config.OriginalSuffixRegex})$",
                RegexOptions.Compiled);
            translatedRegex = new Regex(
                $"^(?<prefix>{config.TranslatedPrefixRegex})(?<white>{config.TranslatedWhiteRegex})(?<text>.*?)(?<suffix>{config.TranslatedSuffixRegex})$",
                RegexOptions.Compiled);
            if (!string.IsNullOrWhiteSpace(config.NameRegex))
            {
                nameRegex = new Regex(config.NameRegex, RegexOptions.Compiled);
            }
            error = null;
            return true;
        }
        catch (Exception exception)
        {
            error = exception.Message;
            return false;
        }
    }

    private static MatchedGroups? TryMatch(Regex regex, string line)
    {
        var match = regex.Match(line);
        if (!match.Success)
        {
            return null;
        }

        return new MatchedGroups
        {
            Prefix = match.Groups["prefix"].Value,
            White = match.Groups["white"].Value,
            Text = match.Groups["text"].Value,
            Suffix = match.Groups["suffix"].Value,
        };
    }

    private static string? TryMatchName(Regex regex, string line)
    {
        var match = regex.Match(line);
        if (!match.Success)
        {
            return null;
        }

        var nameGroup = match.Groups["name"];
        return nameGroup.Success ? nameGroup.Value : null;
    }

    private static List<LineSnapshot> SplitLines(string text)
    {
        var lines = new List<LineSnapshot>();
        var start = 0;
        var lineNumber = 0;

        for (var index = 0; index < text.Length; index++)
        {
            if (text[index] != '\r' && text[index] != '\n')
            {
                continue;
            }

            var lineText = text.Substring(start, index - start);
            lines.Add(new LineSnapshot(lineNumber, lineText, lineText.TrimEnd(), start));
            lineNumber++;

            if (text[index] == '\r' && index + 1 < text.Length && text[index + 1] == '\n')
            {
                index++;
            }

            start = index + 1;
        }

        var tail = start <= text.Length ? text.Substring(start) : string.Empty;
        lines.Add(new LineSnapshot(lineNumber, tail, tail.TrimEnd(), start));
        return lines;
    }

    private static void Adjust(MatchedGroups originalGroups, MatchedGroups translatedGroups)
    {
        if (Contains(originalGroups.White, "「") || Contains(originalGroups.Suffix, "」") || string.IsNullOrEmpty(originalGroups.Text))
        {
            return;
        }

        if (originalGroups.Text[0] != '『' && originalGroups.Text[^1] != '』')
        {
            return;
        }

        var (prefix, suffix) = CheckValid(originalGroups.Text);
        if (!prefix && !suffix)
        {
            return;
        }

        if (prefix)
        {
            originalGroups.White += "『";
            originalGroups.Text = originalGroups.Text[1..];
        }

        if (suffix)
        {
            originalGroups.Suffix = "』" + originalGroups.Suffix;
            originalGroups.Text = originalGroups.Text[..^1];
        }

        if (prefix && !suffix)
        {
            var match = Regex.Match(translatedGroups.Text, "^(?<a>[『“]?)(?<b>.*)$");
            if (match.Groups["a"].Success)
            {
                translatedGroups.White += match.Groups["a"].Value;
                translatedGroups.Text = translatedGroups.Text.Length > 0 ? translatedGroups.Text[1..] : string.Empty;
            }
        }
        else if (!prefix && suffix)
        {
            var match = Regex.Match(translatedGroups.Text, "^(?<b>.*?)(?<c>[”』]?)$");
            if (match.Groups["c"].Success)
            {
                translatedGroups.Suffix = match.Groups["c"].Value + translatedGroups.Suffix;
                translatedGroups.Text = translatedGroups.Text.Length > 0 ? translatedGroups.Text[..^1] : string.Empty;
            }
        }
        else
        {
            var match = Regex.Match(translatedGroups.Text, "^(?<a>[『“]?)(?<b>.*?)(?<c>[”』]?)$");
            if (match.Groups["a"].Success)
            {
                translatedGroups.White += match.Groups["a"].Value;
                translatedGroups.Text = translatedGroups.Text.Length > 0 ? translatedGroups.Text[1..] : string.Empty;
            }

            if (match.Groups["c"].Success)
            {
                translatedGroups.Suffix = match.Groups["c"].Value + translatedGroups.Suffix;
                translatedGroups.Text = translatedGroups.Text.Length > 0 ? translatedGroups.Text[..^1] : string.Empty;
            }
        }
    }

    private static (bool Prefix, bool Suffix) CheckValid(string text)
    {
        var stack = new Stack<int>();

        for (var index = 0; index < text.Length; index++)
        {
            var character = text[index];
            if (character == '『')
            {
                stack.Push(index);
            }
            else if (character == '』')
            {
                if (stack.Count > 0)
                {
                    var position = stack.Pop();
                    if (position == 0 && index == text.Length - 1)
                    {
                        return (true, true);
                    }
                }
                else if (index == text.Length - 1)
                {
                    return (false, true);
                }
            }
        }

        return (stack.Count > 0 && stack.Peek() == 0, false);
    }

    private static bool Contains(string source, string value)
    {
        return source.Contains(value, StringComparison.Ordinal);
    }
}