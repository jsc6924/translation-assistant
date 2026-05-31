using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using editor.Models;

namespace editor.Services;

public static class ParserConfigDetector
{
    private static readonly Regex JapaneseCharacterRegex = new("[\u3040-\u30FF\u4E00-\u9FFFー]", RegexOptions.Compiled);
    private static readonly Dictionary<string, string> ParaMap = new()
    {
        ["{"] = "}",
        ["["] = "]",
        ["("] = ")",
        ["<"] = ">",
        ["《"] = "》",
        ["【"] = "】",
        ["（"] = "）",
    };

    private static readonly Dictionary<string, string> ParaReverseMap = ParaMap.ToDictionary(pair => pair.Value, pair => pair.Key);

    public static bool TryDetect(string documentText, out ParserConfig parserConfig, out string? error)
    {
        parserConfig = new ParserConfig();
        error = null;

        if (string.IsNullOrWhiteSpace(documentText))
        {
            error = "当前文档内容为空，无法识别双行格式。";
            return false;
        }

        var lines = ReadNonEmptyLines(documentText).ToArray();
        if (lines.Length < 2)
        {
            error = "文档行数不足，无法识别双行格式。";
            return false;
        }

        var sampleLines = lines.Take(60).ToArray();
        if (!TryCollectAlternatingLines(sampleLines, out var originalLines, out var translatedLines))
        {
            originalLines = sampleLines.Where((_, index) => index % 2 == 0).ToArray();
            translatedLines = sampleLines.Where((_, index) => index % 2 == 1).ToArray();
        }

        if (originalLines.Length < 2 || translatedLines.Length < 2)
        {
            error = "未能识别出足够的原文和译文示例行。";
            return false;
        }

        string originalPrefix;
        string translatedPrefix;
        try
        {
            originalPrefix = GenerateRegex(originalLines);
            translatedPrefix = GenerateRegex(translatedLines);
        }
        catch
        {
            error = "未能根据行内容生成稳定的前缀正则。请手动配置双行格式。";
            return false;
        }

        if (string.IsNullOrWhiteSpace(originalPrefix) || string.IsNullOrWhiteSpace(translatedPrefix))
        {
            error = "未能识别出稳定的原文或译文前缀。请手动配置双行格式。";
            return false;
        }

        parserConfig = new ParserConfig
        {
            OriginalPrefixRegex = originalPrefix,
            TranslatedPrefixRegex = translatedPrefix,
            OriginalWhiteRegex = "\\s*",
            TranslatedWhiteRegex = "\\s*",
            OriginalSuffixRegex = "[\u300D]?",
            TranslatedSuffixRegex = "[\u300D]?",
        };

        if (!DualLineDocumentParser.TryValidate(parserConfig, out var validationError))
        {
            error = validationError ?? "识别出的双行格式配置无效。";
            return false;
        }

        var parsedDocument = new DualLineDocumentParser().Parse(documentText, parserConfig, true);
        if (parsedDocument.Lines.Count == 0)
        {
            error = "自动识别的格式无法解析当前文本。";
            return false;
        }

        return true;
    }

    private static bool TryCollectAlternatingLines(string[] lines, out string[] originalLines, out string[] translatedLines)
    {
        originalLines = Array.Empty<string>();
        translatedLines = Array.Empty<string>();

        var candidates = lines.Where(ContainsJapaneseCharacters).ToArray();
        if (candidates.Length < 4)
        {
            return false;
        }

        var originals = new List<string>();
        var translated = new List<string>();
        foreach (var line in candidates)
        {
            if (originals.Count == translated.Count)
            {
                originals.Add(line);
            }
            else
            {
                translated.Add(line);
            }
        }

        if (originals.Count > translated.Count)
        {
            originals.RemoveAt(originals.Count - 1);
        }

        if (originals.Count < 2 || translated.Count < 2 || originals.Count != translated.Count)
        {
            return false;
        }

        originalLines = originals.ToArray();
        translatedLines = translated.ToArray();
        return true;
    }

    private static IEnumerable<string> ReadNonEmptyLines(string text)
    {
        using var reader = new StringReader(text);
        string? line;
        while ((line = reader.ReadLine()) is not null)
        {
            var trimmed = line.TrimEnd();
            if (trimmed.Length > 0)
            {
                yield return trimmed;
            }
        }
    }

    private static bool ContainsJapaneseCharacters(string text)
    {
        return JapaneseCharacterRegex.IsMatch(text);
    }

    private static string GenerateRegex(string[] lines)
    {
        if (lines.Length == 0)
        {
            return string.Empty;
        }

        var regStr = string.Empty;
        var openingParens = new List<string>();

        while (true)
        {
            var reg = new Regex($"^({regStr})(.*)", RegexOptions.Compiled);
            var reminders = new List<string>(lines.Length);

            foreach (var line in lines)
            {
                var match = reg.Match(line);
                if (!match.Success)
                {
                    throw new InvalidOperationException("generateRegex error");
                }

                reminders.Add(match.Groups[2].Value);
            }

            if (HasAlphaNumPrefix(reminders))
            {
                regStr += "[0-9a-zA-Z]+";
                continue;
            }

            var candidate = GetCommonPrefix(reminders.ToArray());
            if (!string.IsNullOrEmpty(candidate))
            {
                if (TryReplaceTrailingAlphaNumWithWildcard(candidate, lines, out var optimizedPrefix))
                {
                    if (!string.Equals(optimizedPrefix, Regex.Escape(candidate), StringComparison.Ordinal))
                    {
                        regStr += optimizedPrefix;
                        continue;
                    }
                }

                if (ParaMap.ContainsKey(candidate))
                {
                    openingParens.Add(candidate);
                }
                else if (ParaReverseMap.TryGetValue(candidate, out var left))
                {
                    var position = openingParens.LastIndexOf(left);
                    if (position != -1)
                    {
                        openingParens.RemoveRange(position, openingParens.Count - position);
                    }
                }

                regStr += Regex.Escape(candidate);
                continue;
            }

            if (openingParens.Count > 0)
            {
                var left = openingParens[openingParens.Count - 1];
                openingParens.RemoveAt(openingParens.Count - 1);
                var right = ParaMap[left];
                var candidateReg = $"{regStr}.*?{Regex.Escape(right)}";
                if (MatchAllPrefix(candidateReg, lines))
                {
                    regStr += $".*?{Regex.Escape(right)}";
                    continue;
                }
            }

            break;
        }

        return regStr;
    }

    private static bool HasAlphaNumPrefix(IEnumerable<string> lines)
    {
        foreach (var line in lines)
        {
            if (string.IsNullOrEmpty(line) || !IsAlphaNum(line[0]))
            {
                return false;
            }
        }

        return true;
    }

    private static bool TryReplaceTrailingAlphaNumWithWildcard(string candidate, string[] lines, out string optimizedPrefix)
    {
        optimizedPrefix = candidate;
        if (string.IsNullOrEmpty(candidate))
        {
            return false;
        }

        var lastNonAlphaNum = candidate.Length - 1;
        while (lastNonAlphaNum >= 0 && IsAlphaNum(candidate[lastNonAlphaNum]))
        {
            lastNonAlphaNum--;
        }

        if (lastNonAlphaNum == candidate.Length - 1)
        {
            return false;
        }

        var nextCharIsAlphaNum = false;
        foreach (var line in lines)
        {
            if (line.Length > candidate.Length && IsAlphaNum(line[candidate.Length]))
            {
                nextCharIsAlphaNum = true;
                break;
            }
        }

        if (!nextCharIsAlphaNum)
        {
            return false;
        }

        var fixedPart = candidate.Substring(0, lastNonAlphaNum + 1);
        optimizedPrefix = Regex.Escape(fixedPart) + "[0-9a-zA-Z]+";
        return true;
    }

    private static bool IsAlphaNum(char c)
    {
        return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
    }

    private static bool MatchAllPrefix(string regStr, string[] lines)
    {
        var reg = new Regex($"^({regStr})(.*)", RegexOptions.Compiled);
        foreach (var line in lines)
        {
            if (!reg.IsMatch(line))
            {
                return false;
            }
        }

        return true;
    }

    private static string GetCommonPrefix(string[] lines)
    {
        if (lines.Length == 0)
        {
            return string.Empty;
        }

        var prefix = lines[0];
        for (var i = 1; i < lines.Length; i++)
        {
            prefix = GetCommonPrefix(prefix, lines[i]);
            if (string.IsNullOrEmpty(prefix))
            {
                break;
            }
        }

        return prefix;
    }

    private static string GetCommonPrefix(string first, string second)
    {
        var maxLength = Math.Min(first.Length, second.Length);
        var index = 0;
        while (index < maxLength && first[index] == second[index])
        {
            index++;
        }

        return first.Substring(0, index);
    }
}
