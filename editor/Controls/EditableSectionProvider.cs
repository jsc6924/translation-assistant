using System;
using System.Collections.Generic;
using System.Linq;
using AvaloniaEdit.Document;
using AvaloniaEdit.Editing;
using editor.Models;

namespace editor.Controls;

public sealed class EditableSectionProvider : IReadOnlySectionProvider
{
    private readonly IReadOnlyList<EditableSegment> _editableSegments;

    public EditableSectionProvider(IReadOnlyList<EditableSegment> editableSegments)
    {
        _editableSegments = editableSegments
            .OrderBy(segment => segment.StartOffset)
            .ThenBy(segment => segment.Length)
            .ToArray();
    }

    public bool CanInsert(int offset)
    {
        foreach (var segment in _editableSegments)
        {
            var startOffset = segment.StartOffset;
            var endOffset = segment.StartOffset + segment.Length;
            if (offset >= startOffset && offset <= endOffset)
            {
                return true;
            }
        }

        return false;
    }

    public IEnumerable<ISegment> GetDeletableSegments(ISegment segment)
    {
        foreach (var editableSegment in _editableSegments)
        {
            var startOffset = Math.Max(segment.Offset, editableSegment.StartOffset);
            var endOffset = Math.Min(segment.EndOffset, editableSegment.StartOffset + editableSegment.Length);
            if (endOffset > startOffset)
            {
                yield return new SimpleSegment(startOffset, endOffset - startOffset);
            }
        }
    }
}