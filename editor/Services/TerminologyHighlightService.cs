using System;
using System.Collections.Generic;
using System.Linq;
using editor.Models;

namespace editor.Services;

public sealed class TerminologyHighlightService
{
    private const string MatchAnyTalker = "*";

    public TerminologySnapshot Build(
        string text,
        IReadOnlyList<TerminologyEntry> terms,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, NamingRuleValue>> namingRules,
        IReadOnlyDictionary<int, string>? lineNumberToTalker = null)
    {
        if (string.IsNullOrEmpty(text))
        {
            return TerminologySnapshot.Empty;
        }

        var highlights = new List<TerminologyHighlight>();
        BuildTermHighlights(text, terms, highlights);
        BuildNamingHighlights(text, namingRules, highlights, lineNumberToTalker);

        var merged = MergeOverlaps(highlights);
        return merged.Count == 0 ? TerminologySnapshot.Empty : new TerminologySnapshot(merged);
    }

    private static void BuildTermHighlights(string text, IReadOnlyList<TerminologyEntry> terms, ICollection<TerminologyHighlight> sink)
    {
        if (terms.Count == 0)
        {
            return;
        }

        var termMap = new Dictionary<string, TerminologyEntry>(StringComparer.Ordinal);
        foreach (var term in terms)
        {
            if (string.IsNullOrWhiteSpace(term.Raw))
            {
                continue;
            }

            termMap[term.Raw] = term;
        }

        if (termMap.Count == 0)
        {
            return;
        }

        var matcher = new AhoCorasickMatcher(termMap.Keys);
        foreach (var match in matcher.Search(text))
        {
            if (!termMap.TryGetValue(match.Keyword, out var term))
            {
                continue;
            }

            var hover = string.IsNullOrWhiteSpace(term.Comment)
                ? term.Translation
                : $"{term.Translation} 备注：{term.Comment}";
            sink.Add(new TerminologyHighlight
            {
                StartOffset = match.StartIndex,
                Length = match.Keyword.Length,
                IsNaming = false,
                HoverText = hover,
            });
        }
    }

    private static void BuildNamingHighlights(string text, IReadOnlyDictionary<string, IReadOnlyDictionary<string, NamingRuleValue>> namingRules, ICollection<TerminologyHighlight> sink, IReadOnlyDictionary<int, string>? lineNumberToTalker)
    {
        if (namingRules.Count == 0)
        {
            return;
        }

        var allCalleds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var calledMap in namingRules.Values)
        {
            foreach (var called in calledMap.Keys)
            {
                if (!string.IsNullOrWhiteSpace(called))
                {
                    allCalleds.Add(called);
                }
            }
        }

        if (allCalleds.Count == 0)
        {
            return;
        }

        var inverted = BuildInvertedNamingMap(namingRules);
        var matcher = new AhoCorasickMatcher(allCalleds);
        foreach (var match in matcher.Search(text))
        {
            var resolveCaller = GetCallerForPosition(text, match.StartIndex, lineNumberToTalker);
            var resolution = ResolveNaming(match.Keyword, namingRules, inverted, resolveCaller);
            if (string.IsNullOrWhiteSpace(resolution.Trans))
            {
                continue;
            }

            var hover = resolution.Trans;
            if (!string.IsNullOrWhiteSpace(resolution.FallbackComment))
            {
                hover += $" ({resolution.FallbackComment})";
            }
            if (!string.IsNullOrWhiteSpace(resolution.RuleComment))
            {
                hover += $" 备注：{resolution.RuleComment}";
            }

            sink.Add(new TerminologyHighlight
            {
                StartOffset = match.StartIndex,
                Length = match.Keyword.Length,
                IsNaming = true,
                HoverText = hover,
            });
        }
    }

    private static IReadOnlyDictionary<string, IReadOnlyDictionary<string, NamingRuleValue>> BuildInvertedNamingMap(
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, NamingRuleValue>> namingRules)
    {
        var result = new Dictionary<string, IReadOnlyDictionary<string, NamingRuleValue>>(StringComparer.Ordinal);
        var temp = new Dictionary<string, Dictionary<string, NamingRuleValue>>(StringComparer.Ordinal);
        foreach (var (caller, calledMap) in namingRules)
        {
            foreach (var (called, ruleValue) in calledMap)
            {
                if (!temp.TryGetValue(called, out var callerMap))
                {
                    callerMap = new Dictionary<string, NamingRuleValue>(StringComparer.Ordinal);
                    temp[called] = callerMap;
                }

                callerMap[caller] = ruleValue;
            }
        }

        foreach (var (called, callerMap) in temp)
        {
            result[called] = callerMap;
        }

        return result;
    }

    private static NamingResolution ResolveNaming(
        string called,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, NamingRuleValue>> namingRules,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, NamingRuleValue>> inverted,
        string? callerName)
    {
        if (!string.IsNullOrWhiteSpace(callerName)
            && namingRules.TryGetValue(callerName, out var directRules)
            && directRules.TryGetValue(called, out var directRule))
        {
            return new NamingResolution(
                GetTranslation(directRule),
                null,
                directRule.Comment);
        }

        if (namingRules.TryGetValue(MatchAnyTalker, out var wildcardRules)
            && wildcardRules.TryGetValue(called, out var wildcardRule))
        {
            return new NamingResolution(
                GetTranslation(wildcardRule),
                null,
                wildcardRule.Comment);
        }

        if (!inverted.TryGetValue(called, out var callerMap))
        {
            return NamingResolution.Empty;
        }

        var fallbackCandidates = new List<string>();
        string? firstTranslation = null;
        string? firstComment = null;
        foreach (var (caller, rule) in callerMap)
        {
            var transcaller = GetTranslation(rule);
            if (string.IsNullOrWhiteSpace(transcaller))
            {
                continue;
            }

            fallbackCandidates.Add($"{caller}: {transcaller}");
            if (firstTranslation is null)
            {
                firstTranslation = transcaller;
                firstComment = rule.Comment;
            }
        }

        if (string.IsNullOrWhiteSpace(firstTranslation))
        {
            return NamingResolution.Empty;
        }

        return new NamingResolution(firstTranslation, fallbackCandidates.Count > 0 ? string.Join(", ", fallbackCandidates) : null, firstComment);
    }

    private static string? GetCallerForPosition(string text, int offset, IReadOnlyDictionary<int, string>? lineNumberToTalker)
    {
        if (lineNumberToTalker is null || lineNumberToTalker.Count == 0)
        {
            return null;
        }

        var lineNumber = GetLineNumberAtOffset(text, offset);
        return lineNumberToTalker.TryGetValue(lineNumber, out var talker) ? talker : null;
    }

    private static int GetLineNumberAtOffset(string text, int offset)
    {
        var line = 0;
        for (var i = 0; i < offset && i < text.Length; i++)
        {
            if (text[i] == '\n')
            {
                line++;
            }
        }

        return line;
    }

    private static string GetTranslation(NamingRuleValue ruleValue)
    {
        return (ruleValue.Transcaller ?? string.Empty).Replace("\"", string.Empty, StringComparison.Ordinal);
    }

    private static List<TerminologyHighlight> MergeOverlaps(List<TerminologyHighlight> highlights)
    {
        if (highlights.Count <= 1)
        {
            return highlights;
        }

        highlights.Sort((a, b) =>
        {
            if (a.StartOffset == b.StartOffset)
            {
                return b.Length.CompareTo(a.Length);
            }

            return a.StartOffset.CompareTo(b.StartOffset);
        });

        var result = new List<TerminologyHighlight>();
        foreach (var highlight in highlights)
        {
            if (result.Count == 0)
            {
                result.Add(highlight);
                continue;
            }

            var last = result[^1];
            var lastEnd = last.StartOffset + last.Length;
            var currentEnd = highlight.StartOffset + highlight.Length;
            if (highlight.StartOffset < lastEnd)
            {
                if (currentEnd > lastEnd)
                {
                    result.Add(highlight);
                }

                continue;
            }

            result.Add(highlight);
        }

        return result;
    }

    private readonly record struct NamingResolution(string? Trans, string? FallbackComment, string? RuleComment)
    {
        public static readonly NamingResolution Empty = new(null, null, null);
    }
}
