using System.Collections.Generic;
using System.Linq;

namespace editor.Models;

public sealed class TerminologySnapshot
{
    public static readonly TerminologySnapshot Empty = new([]);

    private readonly IReadOnlyList<TerminologyHighlight> _highlights;

    public TerminologySnapshot(IReadOnlyList<TerminologyHighlight> highlights)
    {
        _highlights = highlights.OrderBy(highlight => highlight.StartOffset).ToList();
    }

    public IReadOnlyList<TerminologyHighlight> Highlights => _highlights;

    public TerminologyHighlight? FindByOffset(int offset)
    {
        foreach (var highlight in _highlights)
        {
            if (offset < highlight.StartOffset)
            {
                return null;
            }

            var endOffset = highlight.StartOffset + highlight.Length;
            if (offset >= highlight.StartOffset && offset < endOffset)
            {
                return highlight;
            }
        }

        return null;
    }
}
