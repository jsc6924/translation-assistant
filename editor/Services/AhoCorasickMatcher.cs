using System;
using System.Collections.Generic;
using System.Linq;

namespace editor.Services;

public sealed class AhoCorasickMatcher
{
    private sealed class Node
    {
        public readonly Dictionary<char, Node> Next = [];
        public Node? Failure;
        public readonly List<string> Outputs = [];
    }

    public readonly record struct Match(int EndIndex, string Keyword)
    {
        public int StartIndex => EndIndex - Keyword.Length + 1;
    }

    private readonly Node _root = new();

    public AhoCorasickMatcher(IEnumerable<string> keywords)
    {
        foreach (var keyword in keywords)
        {
            if (string.IsNullOrWhiteSpace(keyword))
            {
                continue;
            }

            Insert(keyword);
        }

        BuildFailureLinks();
    }

    public List<Match> Search(string text)
    {
        var matches = new List<Match>();
        var state = _root;

        for (var i = 0; i < text.Length; i++)
        {
            var ch = text[i];
            while (state != _root && !state.Next.ContainsKey(ch))
            {
                state = state.Failure ?? _root;
            }

            if (state.Next.TryGetValue(ch, out var next))
            {
                state = next;
            }
            else
            {
                state = _root;
            }

            if (state.Outputs.Count == 0)
            {
                continue;
            }

            foreach (var keyword in state.Outputs)
            {
                matches.Add(new Match(i, keyword));
            }
        }

        return matches;
    }

    private void Insert(string keyword)
    {
        var node = _root;
        foreach (var ch in keyword)
        {
            if (!node.Next.TryGetValue(ch, out var next))
            {
                next = new Node();
                node.Next[ch] = next;
            }

            node = next;
        }

        if (!node.Outputs.Contains(keyword, StringComparer.Ordinal))
        {
            node.Outputs.Add(keyword);
        }
    }

    private void BuildFailureLinks()
    {
        var queue = new Queue<Node>();
        _root.Failure = _root;

        foreach (var child in _root.Next.Values)
        {
            child.Failure = _root;
            queue.Enqueue(child);
        }

        while (queue.Count > 0)
        {
            var node = queue.Dequeue();
            foreach (var (ch, child) in node.Next)
            {
                var failure = node.Failure ?? _root;
                while (failure != _root && !failure.Next.ContainsKey(ch))
                {
                    failure = failure.Failure ?? _root;
                }

                if (failure.Next.TryGetValue(ch, out var fallback))
                {
                    child.Failure = fallback;
                }
                else
                {
                    child.Failure = _root;
                }

                foreach (var output in child.Failure.Outputs)
                {
                    if (!child.Outputs.Contains(output, StringComparer.Ordinal))
                    {
                        child.Outputs.Add(output);
                    }
                }

                queue.Enqueue(child);
            }
        }
    }
}
