namespace editor.Models;

public sealed class ParsedLineInfo
{
    public int LineNumber { get; init; }

    public ParsedLineKind Kind { get; init; }

    public int EditableStartOffset { get; init; }

    public int EditableLength { get; init; }
}