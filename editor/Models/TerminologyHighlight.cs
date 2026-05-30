namespace editor.Models;

public sealed class TerminologyHighlight
{
    public int StartOffset { get; init; }

    public int Length { get; init; }

    public bool IsNaming { get; init; }

    public string HoverText { get; init; } = string.Empty;
}
