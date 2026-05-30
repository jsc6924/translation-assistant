using System.Collections.Generic;
using AvaloniaEdit.Document;
using AvaloniaEdit.Editing;

namespace editor.Controls;

public sealed class AllowAllReadOnlySectionProvider : IReadOnlySectionProvider
{
    public static AllowAllReadOnlySectionProvider Instance { get; } = new();

    private AllowAllReadOnlySectionProvider()
    {
    }

    public bool CanInsert(int offset)
    {
        return true;
    }

    public IEnumerable<ISegment> GetDeletableSegments(ISegment segment)
    {
        yield return segment;
    }
}