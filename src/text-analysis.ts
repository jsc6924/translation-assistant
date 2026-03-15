import * as vscode from 'vscode';
import { batchProcess, selectBatchRange } from "./batch";
import { DocumentParser } from "./parser";

class TextSentence {
    constructor(
        public fileID: number,
        public line: number, // zero based
        public text: string
    ) {
    }
}

type Segment = {
    start: number,
    end: number,
}

class SegmentGroup {
    constructor(
        public segments: Segment[],
    ) {
    }

    addSegment(segment: Segment) {
        this.segments.push(segment);
    }

    sortSegments() {
        this.segments.sort((a, b) => {
            if (a.start !== b.start) {
                return a.start - b.start;
            }
            return a.end - b.end;
        });
    }

    // suppose both this group and the other group is sorted
    isSubsetOf(other: SegmentGroup): boolean {
        for (let i = 0; i < this.segments.length; i++) {
            const seg = this.segments[i];
            // find the first segment in other that ends after seg
            let j = -1;
            for (let stepSize = Math.floor(other.segments.length / 2); stepSize > 0; stepSize = stepSize >> 1) {
                if (j + stepSize < other.segments.length && other.segments[j + stepSize].end <= seg.end) {
                    j += stepSize;
                }
            }
            if (j === -1 || other.segments[j].start > seg.start) {
                return false;
            }
        }
        return true;
    }
}

class Corpus {
    sentences: TextSentence[] = [];
    files: Map<number, string> = new Map();
    nextID: number = 1;

    addFile(filePath: string): number {
        const id = this.nextID++;
        this.files.set(id, filePath);
        return id;
    }

    addSentence(fileID: number, line: number, text: string) {
        const sentence = new TextSentence(fileID, line, text);
        this.sentences.push(sentence);
    }

    computeDupSegments(maxSegmentLength: number = 100): SegmentGroup[][] {
        const SegGroupsByLength: SegmentGroup[][] = []; // length -> first sentence -> group list that starts with the sentence
        // ensure SegGroupsByLength has enough length
        for (let i = 0; i <= maxSegmentLength; i++) {
            SegGroupsByLength.push([]);
        }

        // fill length 1 segments
        const groupMap = new Map<string, SegmentGroup>();
        for (let i = 0; i < this.sentences.length; i++) {
            const sentence = this.sentences[i];
            const text = sentence.text;
            if (!text) {
                continue;
            }
            if (!groupMap.has(text)) {
                groupMap.set(text, new SegmentGroup([{ start: i, end: i + 1 }]));
            } else {
                const group = groupMap.get(text)!;
                group.addSegment({ start: i, end: i + 1 });
            }
        }

        // filter out groups that only appear once
        const segGroups = Array.from(groupMap.values()).filter(g => g.segments.length > 1);
        SegGroupsByLength[1] = segGroups;

        // build longer segments based on shorter segments
        for (let length = 2; length <= maxSegmentLength; length++) {
            const prevGroups = SegGroupsByLength[length - 1];
            if (!prevGroups) {
                break;
            }
            const markForRemoval = new Set<number>(); // index of prevGroups that are subsets of new groups
            for (let i = 0; i < prevGroups.length; i++) {
                const group = prevGroups[i];
                const newGroupMap = new Map<string, SegmentGroup>(); // next sentence -> groups that have the same next sentence
                for (const seg of group.segments) {
                    if (seg.end >= this.sentences.length) {
                        continue;
                    }
                    const nextSentence = this.sentences[seg.end];
                    if (!newGroupMap.has(nextSentence.text)) {
                        newGroupMap.set(nextSentence.text, new SegmentGroup([{ start: seg.start, end: seg.end + 1 }]));
                    } else {
                        const newGroup = newGroupMap.get(nextSentence.text)!;
                        newGroup.addSegment({ start: seg.start, end: seg.end + 1 });
                    }
                }
                const newGroups = Array.from(newGroupMap.values()).filter(g => g.segments.length > 1);
                newGroups.forEach(g => g.sortSegments());
                if (newGroups.length === 1 && newGroups[0].segments.length === group.segments.length) {
                    // if there is only one new group, then all segments in the old group are subsets of the new group, so we can mark the old group for removal
                    markForRemoval.add(i);
                }
                SegGroupsByLength[length].push(...newGroups);
            }
            const filteredPrevGroups = prevGroups.filter((g, i) => {
                if (markForRemoval.has(i)) {
                    return false;
                }
                for (const group of SegGroupsByLength[length]) {
                    if (g.isSubsetOf(group)) {
                        return false;
                    }
                }
                return true;
            });
            SegGroupsByLength[length - 1] = filteredPrevGroups;
        }
        return SegGroupsByLength;
    }
}
    

export async function TextAnalysis(documentUris: vscode.Uri[]) {
    const corpus = new Corpus();

    await batchProcess(documentUris, doc => {
        const fileID = corpus.addFile(doc.uri.fsPath);
        DocumentParser.processPairedLines(doc, (jgrps, cgrps, j_index, c_index) => {
            corpus.addSentence(fileID, j_index, jgrps.text);
        });
    });

    const results = corpus.computeDupSegments();
    const output = formatResults(corpus, results);

    const doc = await vscode.workspace.openTextDocument({
        content: output,
        language: 'markdown'
    });
    await vscode.window.showTextDocument(doc);
}

function formatResults(corpus: Corpus, results: SegmentGroup[][]): string {
    let output = "# 文本重复分析\n\n";
    let found = false;
    let minLengthToShow = 4;

    for (let length = results.length - 1; length >= minLengthToShow; length--) {
        const groups = results[length];
        if (!groups || groups.length === 0) {
            continue;
        }

        found = true;
        output += `## 长度 ${length}\n\n`;

        for (const group of groups) {
            const firstSeg = group.segments[0];
            output += "### 内容\n";
            output += "```\n";
            for (let i = firstSeg.start; i < firstSeg.end; i++) {
                output += corpus.sentences[i].text + "\n";
            }
            output += "```\n\n";

            output += "### 位置\n";
            for (const seg of group.segments) {
                const sentence = corpus.sentences[seg.start];
                const filePath = corpus.files.get(sentence.fileID);
                if (filePath) {
                    const uri = vscode.Uri.file(filePath);
                    const lineSuffix = `#${sentence.line + 1}`;
                    // Use uri.toString() to correctly format the file scheme for VS Code markdown
                    output += `- [${vscode.workspace.asRelativePath(uri)}:${sentence.line + 1}](${uri.toString()}${lineSuffix})\n`;
                }
            }
            output += "\n---\n\n";
        }
    }

    if (!found) {
        output += "未找到重复段落。\n";
    }
    return output;
}

