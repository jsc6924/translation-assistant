namespace editor.Models;

public sealed class TerminologyEntry
{
    public string Raw { get; init; } = string.Empty;

    public string Translation { get; init; } = string.Empty;

    public string? Comment { get; init; }
}
