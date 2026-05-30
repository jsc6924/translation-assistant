namespace editor.Models;

public sealed class SimpleTmPreviewItem
{
    public SimpleTmPreviewItem(string raw, string translation, string? comment)
    {
        Raw = raw;
        Translation = translation;
        Comment = string.IsNullOrWhiteSpace(comment) ? string.Empty : comment;
    }

    public string Raw { get; }

    public string Translation { get; }

    public string Comment { get; }
}
