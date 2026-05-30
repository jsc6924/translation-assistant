using System.Collections.Generic;
using System.Linq;

namespace editor.Models;

public sealed class ParsedDocument
{
    private readonly IReadOnlyDictionary<int, ParsedLineInfo> _lineIndex;

    public ParsedDocument(bool isConfigured, IReadOnlyList<ParsedLineInfo>? lines = null, IReadOnlyList<EditableSegment>? editableSegments = null)
    {
        IsConfigured = isConfigured;
        Lines = lines ?? [];
        EditableSegments = editableSegments ?? [];
        _lineIndex = Lines.ToDictionary(line => line.LineNumber);
    }

    public bool IsConfigured { get; }

    public IReadOnlyList<ParsedLineInfo> Lines { get; }

    public IReadOnlyList<EditableSegment> EditableSegments { get; }

    public ParsedLineInfo? GetLine(int lineNumber)
    {
        return _lineIndex.TryGetValue(lineNumber, out var lineInfo) ? lineInfo : null;
    }
}