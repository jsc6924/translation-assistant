using System;
using Avalonia;
using Avalonia.Media;
using AvaloniaEdit.Document;
using AvaloniaEdit.Rendering;
using editor.Models;

namespace editor.Controls;

public sealed class DualLineColorizer : DocumentColorizingTransformer
{
    private static readonly IBrush TermHighlightBrush = new SolidColorBrush(Color.Parse("#80ffe58f"));
    private static readonly IBrush NamingHighlightBrush = new SolidColorBrush(Color.Parse("#80c2e7ff"));

    private ParsedDocument _parsedDocument = new(false);
    private TerminologySnapshot _terminologySnapshot = TerminologySnapshot.Empty;

    private static IBrush GetResourceBrush(string key, IBrush fallback)
    {
        if (Application.Current?.Resources.TryGetResource(key, null, out var resource) == true
            && resource is IBrush brush)
        {
            return brush;
        }

        return fallback;
    }

    public void Update(ParsedDocument parsedDocument, TerminologySnapshot terminologySnapshot)
    {
        _parsedDocument = parsedDocument;
        _terminologySnapshot = terminologySnapshot;
    }

    protected override void ColorizeLine(DocumentLine line)
    {
        if (line.Length == 0)
        {
            return;
        }

        var lineInfo = _parsedDocument.GetLine(line.LineNumber - 1);
        if (lineInfo is null || lineInfo.Kind == ParsedLineKind.Other)
        {
            ApplyTerminologyHighlights(line);
            return;
        }

        var prefixLength = lineInfo.PrefixLength;
        if (prefixLength <= 0)
        {
            ApplyTerminologyHighlights(line);
            return;
        }

        var start = line.Offset;
        var end = line.EndOffset;
        var mid = start + prefixLength;
        var suffixStart = Math.Max(mid, end - lineInfo.SuffixLength);

        if (lineInfo.Kind == ParsedLineKind.Original)
        {
            var prefixBrush = GetResourceBrush("EditorOriginalPrefixBrush", new SolidColorBrush(Color.Parse("#80006c28")));
            var textBrush = GetResourceBrush("EditorOriginalTextBrush", new SolidColorBrush(Color.Parse("#008E44")));

            ChangeLinePart(start, mid, element =>
            {
                element.TextRunProperties.SetForegroundBrush(prefixBrush);
            });

            if (suffixStart > mid)
            {
                ChangeLinePart(mid, suffixStart, element =>
                {
                    element.TextRunProperties.SetForegroundBrush(textBrush);
                });
                ChangeLinePart(suffixStart, end, element =>
                {
                    element.TextRunProperties.SetForegroundBrush(prefixBrush);
                });
            }
            else
            {
                ChangeLinePart(mid, end, element =>
                {
                    element.TextRunProperties.SetForegroundBrush(textBrush);
                });
            }
        }
        else if (lineInfo.Kind == ParsedLineKind.Translated)
        {
            var prefixBrush = GetResourceBrush("EditorTranslatedPrefixBrush", new SolidColorBrush(Color.Parse("#80000000")));
            var textBrush = GetResourceBrush("EditorTranslatedTextBrush", new SolidColorBrush(Color.Parse("#000000")));

            ChangeLinePart(start, mid, element =>
            {
                element.TextRunProperties.SetForegroundBrush(prefixBrush);
            });

            if (suffixStart > mid)
            {
                ChangeLinePart(mid, suffixStart, element =>
                {
                    element.TextRunProperties.SetForegroundBrush(textBrush);
                });
                ChangeLinePart(suffixStart, end, element =>
                {
                    element.TextRunProperties.SetForegroundBrush(prefixBrush);
                });
            }
            else
            {
                ChangeLinePart(mid, end, element =>
                {
                    element.TextRunProperties.SetForegroundBrush(textBrush);
                });
            }
        }

        ApplyTerminologyHighlights(line);

    }

    private void ApplyTerminologyHighlights(DocumentLine line)
    {
        if (_terminologySnapshot.Highlights.Count == 0)
        {
            return;
        }

        var lineStart = line.Offset;
        var lineEnd = line.EndOffset;
        foreach (var highlight in _terminologySnapshot.Highlights)
        {
            var highlightStart = highlight.StartOffset;
            if (highlightStart >= lineEnd)
            {
                break;
            }

            var highlightEnd = highlight.StartOffset + highlight.Length;
            if (highlightEnd <= lineStart)
            {
                continue;
            }

            var start = Math.Max(lineStart, highlightStart);
            var end = Math.Min(lineEnd, highlightEnd);
            var brush = highlight.IsNaming ? NamingHighlightBrush : TermHighlightBrush;
            ChangeLinePart(start, end, element =>
            {
                element.TextRunProperties.SetBackgroundBrush(brush);
            });
        }
    }
}