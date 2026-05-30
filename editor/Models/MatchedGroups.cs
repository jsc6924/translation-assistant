namespace editor.Models;

public sealed class MatchedGroups
{
    public string Prefix { get; set; } = string.Empty;

    public string White { get; set; } = string.Empty;

    public string Text { get; set; } = string.Empty;

    public string Suffix { get; set; } = string.Empty;

    public MatchedGroups Clone()
    {
        return new MatchedGroups
        {
            Prefix = Prefix,
            White = White,
            Text = Text,
            Suffix = Suffix,
        };
    }
}