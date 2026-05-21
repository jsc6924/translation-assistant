import * as vscode from 'vscode';
import isFullwidthCodePoint from 'is-fullwidth-code-point';
import * as utils from './utils';
import { updateNewlineDecorations } from './decoration';
import { MatchedGroups } from './parser';
import { formatNewlineInLine } from './formatter';
import { getChineseTokenizer } from './tokenizer';

const tagStatusNormal = 0;
const tagStatusTag = 1;
const tagStatusInTag = 2;
function tagStatus(text: string): number[] {
    const status = new Array(text.length).fill(0);
    let lastIndexAfterTag = -1;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '<') {
            status[i] = tagStatusTag;
            if (i + 1 >= text.length) {
                break;
            }

            if (text[i+1] === '/') {
                status[i] = tagStatusTag;
                if (lastIndexAfterTag >= 0) {
                    for (let j = lastIndexAfterTag; j < i; j++) {
                        status[j] = tagStatusInTag;
                    }
                }
            }

            for (; i < text.length && text[i] !== '>'; i++) {
                status[i] = tagStatusTag;
            }
            if (i < text.length) {
                status[i] = tagStatusTag; // the '>' char
            }
            lastIndexAfterTag = i + 1;
            continue;
        } else if (text[i] === '\\') {
            status[i] = tagStatusTag;
            if (i + 1 < text.length) {
                status[i+1] = tagStatusTag;
                i++;
            }
        } else {
            status[i] = tagStatusNormal;
        }
    }
    return status;
}

function widthArr(text: string, tagStatusArr: number[]): number[] {
    const arr = new Array(text.length).fill(0);
    let width = 0;
    for (let i = 0; i < text.length; i++) {
        if (tagStatusArr[i] === tagStatusTag) {
            arr[i] = width;
            continue;
        }
        if (text[i] === '—' || text[i] === '…') {
            width += 2;
            arr[i] = width;
            continue;
        }
        const c = text.charCodeAt(i);
        // if c is a fullwidth character   
        if (isFullwidthCodePoint(c)) {
            width += 2;
        } else {
            width += 1;
        }
        arr[i] = width;
    }
    return arr;
}

export function calcDisplayWidth(text: string): number {
    const widths = widthArr(text, tagStatus(text));
    return widths.length > 0 ? widths[widths.length - 1] : 0;
}

// return the replaced full line
export function insert_newline_for_line(jgrps: MatchedGroups, cgrps: MatchedGroups, newline: string, deleteNewlineRegex: RegExp, maxlen: number): string {
    const insertNewline = newline + utils.repeatStr('　', cgrps.white.length, false);

    const margin = calcDisplayWidth(cgrps.white) + calcDisplayWidth(cgrps.suffix);
    const adjustedMaxLen = Math.max(maxlen - margin, 5); // set a lower bound for maxlen to avoid too aggressive splitting

    // remove all newlineRegex in text
    deleteNewlineRegex.lastIndex = 0;
    let text = cgrps.text;
    text = text.replace(deleteNewlineRegex, '');
    // text = text.replace(/(?<=[？！])[\s　]/g, '');

    const MAX_LINE = 3;
    const preferredMaxLen = Math.min(adjustedMaxLen, 24);
    const tagStatusArr = tagStatus(text);
    const widths = widthArr(text, tagStatusArr);

    // no need to split
    if (!text || widths[widths.length - 1] <= preferredMaxLen) {
        return assembleLines(jgrps, cgrps, [text], insertNewline);
    }

    const [valid, lines] = split_to_lines(text, widths, tagStatusArr, preferredMaxLen, MAX_LINE, [0.6, 0.2]);
    if (valid) {
        return assembleLines(jgrps, cgrps, lines, insertNewline);
    }

    const [valid3, lines3] = split_to_lines(text, widths, tagStatusArr, adjustedMaxLen, MAX_LINE, [0.6, 0.4, 0.1, 0]);
    if (valid3) {
        return assembleLines(jgrps, cgrps, lines3, insertNewline);
    }

    const [valid32, lines32] = split_to_lines(text, widths, tagStatusArr, maxlen, MAX_LINE, [0.1, 0]);
    if (valid32) {
        return assembleLines(jgrps, cgrps, lines32, insertNewline);
    }

    const [valid4, lines4] = split_to_lines(text, widths, tagStatusArr, maxlen, 4, [0]);
    if (valid4) {
        return assembleLines(jgrps, cgrps, lines4, insertNewline);
    }

    return assembleLines(jgrps, cgrps, [text], insertNewline);
}

function cut_force_by_word(text: string): Int8Array {
    const wordLengths = getChineseTokenizer().cut(text, true).map((w: string) => w.length);
    const res = Int8Array.from({length: text.length}, () => 0);

    const sumLength = wordLengths.reduce((a: number, b: number) => a + b, 0);
    if (sumLength !== text.length) {
        return res;
    }
    let pos = 0;
    for (const len of wordLengths) {
        res[pos + len - 1] = 1; // the space after a word is a preferred split point
        pos += len;
    }
    return res;
}

function split_to_lines(text: string, widths: number[], tagStatusArr: number[], maxLen: number, maxline: number, alphas: number[]): [boolean, string[]] {
    if (!text) {
        return [false, []];
    }   

    const maxWidth = maxLen * 2;
    const totalWidth = widths[widths.length - 1];
    const L = Math.ceil(totalWidth / maxWidth);
    if (L > maxline) {
        return [false, []];
    }
    const S = L - 1; // number of split

    const n = text.length;
    if (n < 2) {
        return [true, [text]];
    }
    const strength = new Array(n-1).fill(0.0); // difficulty of splitting at position i (between i and i+1), smaller is easier to split
    const alphanum = /[a-zA-Z0-9]/;
    const puncs = /[。？！，、—…」』]/;
    const periodPuncs = /[。？！]/;

    const isPunc = new Array(n).fill(0.0).map((_, i) => puncs.test(text[i]));
    const wordCutForce = cut_force_by_word(text);
    for (let i = 0; i < n - 1; i++) {
        if (tagStatusArr[i] === tagStatusTag || tagStatusArr[i] === tagStatusInTag) {
            if (tagStatusArr[i+1] === tagStatusTag) {
                strength[i] += 10000.0; // split tag is not valid
            } else if (tagStatusArr[i+1] === tagStatusInTag) {
                strength[i] += 10000.0; // split in tag is not valid either
            }
        } else if (text[i] === '\\') {
            strength[i] += 10.0; // backslash is usually used for escaping, therefore not a good split point
        } else if (isPunc[i]) {
            if (isPunc[i+1]) {
                strength[i] += 1.0; // punc -> punc
            } else {
                // punc -> alpha/normal
                if(periodPuncs.test(text[i])) {
                    strength[i] -= 1.5; // 句号等
                } else {
                    strength[i] -= 1.25; // 其他标点，比如逗号
                }
            }
        } else if (alphanum.test(text[i])) {
            if (alphanum.test(text[i+1])) {
                strength[i] += 3.0; // normal -> normal
            } else if (isPunc[i+1]) {
                strength[i] += 1.0; // normal -> punc
            } else {
                // normal -> alpha
            }
        } else {
            if (isPunc[i+1]) {
                strength[i] += 1.0; // alpha -> punc
            } else {
                // alpha -> alpha/normal
                strength[i] -= 0.3 * wordCutForce[i]; // 词的末尾
            }
        }
    }

    const splitCenters = new Array(S).fill(0.0).map((_, i) => totalWidth / L * (i + 1) - 1);

    for (const alpha of alphas) { // weight of split by punc
        const beta = 1.0 - alpha; // weight of split by maxlen
        const hold = 2.0;
        const lines = [] as string[];
        const linesWidth = [] as number[];
        let lastSplitIndex = 0;

        const holdForce = new Array(n-1).fill(0.0).map((_, i) => {
            return i >= lastSplitIndex ? normalPdf(widths[i], 0, 5.0) + normalPdf(widths[i], totalWidth, 5.0) : 100;
        });
        normalizeInPlace(holdForce);

        for (const c of splitCenters) {
            const splitForce = new Array(n-1).fill(0.0).map((_, i) => {
                return i >= lastSplitIndex ? normalPdf(widths[i], c, 5.0) : 0;
            });
            normalizeInPlace(splitForce);

            const score = new Array(n-1).fill(0.0).map((_, i) => {
                return alpha * strength[i] - beta * splitForce[i] + hold * holdForce[i];
            });

            const split_index = score.indexOf(Math.min(...score));
            const line = text.slice(lastSplitIndex, split_index + 1);
            lines.push(line);

            const prevLen = lastSplitIndex > 0 ? widths[lastSplitIndex - 1] : 0;
            linesWidth.push(widths[split_index] - prevLen);
            lastSplitIndex = split_index + 1;    
        }
        lines.push(text.slice(lastSplitIndex));
        const prevLen = lastSplitIndex > 0 ? widths[lastSplitIndex - 1] : 0;
        linesWidth.push(widths[lastSplitIndex] - prevLen);

        let valid = linesWidth.every(w => w <= maxWidth);
        if (valid) {
            return [true, lines];
        }
    }

    return [false, []];
}

function assembleLines(jgrps: MatchedGroups, cgrps: MatchedGroups, lines: string[], insertNewline: string): string {
    const raw = lines.join(insertNewline);
    cgrps.text = raw;
    const config = vscode.workspace.getConfiguration("dltxt");
    const nestedLineToken = config.get("nestedLine.token") as string;
    const escapedNestedLineToken = nestedLineToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const spaceAfterNewlineOption = config.get("formatter.c.addSpaceAfterNewline") as string;
    formatNewlineInLine(spaceAfterNewlineOption, escapedNestedLineToken, jgrps, cgrps);
    return `${cgrps.prefix}${cgrps.white}${cgrps.text}${cgrps.suffix}`;
}



function normalizeInPlace(force: number[]) {
    const maxAbs = Math.max(...force.map(Math.abs));
    if (maxAbs === 0) {
        return;
    }
    const ratio = 1.0 / maxAbs;
    for (let i = 0; i < force.length; i++) {
        force[i] *= ratio;
    }
}

function normalPdf(x: number, mean: number, stddev: number): number {
    const variance = stddev * stddev;
    const denominator = Math.sqrt(2 * Math.PI * variance);
    const exponent = -((x - mean) * (x - mean)) / (2 * variance);
    return (1 / denominator) * Math.exp(exponent);
}


export async function setNewlineToken(){
    const config = vscode.workspace.getConfiguration("dltxt");
    const curToken = config.get<string>('nestedLine.token');
    let token = await vscode.window.showInputBox({
      prompt: "设置换行符标记（留空则不修改）",
      placeHolder: `当前值：${curToken}`,
    });
    if (token !== undefined && token.length > 0) {
      await config.update('nestedLine.token', token, vscode.ConfigurationTarget.Workspace);
    }

    const curLineMax = config.get<number>('nestedLine.maxLen');
    const inputLineMax = await vscode.window.showInputBox({
      prompt: "设置换行符标记最大长度（留空则不修改）",
      placeHolder: `当前值：${curLineMax}`,
      validateInput: (value) => {
        if (value === '') {
          return null;
        }
        const n = Number(value);
        if (isNaN(n) || n <= 0 || !Number.isInteger(n)) {
          return "请输入正整数";
        }
      }
    });
    if (inputLineMax !== undefined && inputLineMax !== '') {
      const n = Number(inputLineMax);
      await config.update('nestedLine.maxLen', n, vscode.ConfigurationTarget.Workspace);
    }
    vscode.window.showInformationMessage(`换行符设置已更新为：${token}，最大长度：${config.get<number>('nestedLine.maxLen')}`);
    updateNewlineDecorations();
};