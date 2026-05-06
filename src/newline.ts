import * as vscode from 'vscode';
import isFullwidthCodePoint from 'is-fullwidth-code-point';
import * as utils from './utils';
import { updateNewlineDecorations } from './error-check';

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

export function insert_newline_for_line(text: string, insertNewline: string, deleteNewlineRegex: RegExp, maxlen: number): string {
    // remove all newlineRegex in text
    deleteNewlineRegex.lastIndex = 0;
    text = text.replace(deleteNewlineRegex, '');
    text = text.replace(/(?<=[？！])[\s　]/g, '');

    const MAX_LINE = 3;
    const wantedMaxLen = Math.min(maxlen, 24);
    const tagStatusArr = tagStatus(text);
    const widths = widthArr(text, tagStatusArr);

    // no need to split
    if (!text || widths[widths.length - 1] <= wantedMaxLen) {
        return assembleLines([text], insertNewline);
    }

    const [valid, lines] = split_to_lines(text, widths, tagStatusArr, wantedMaxLen, MAX_LINE, [0.6]);
    if (valid) {
        return assembleLines(lines, insertNewline);
    }

    const [valid3, lines3] = split_to_lines(text, widths, tagStatusArr, maxlen, MAX_LINE, [0.6, 0.4, 0.1, 0]);
    if (valid3) {
        return assembleLines(lines3, insertNewline);
    }

    return assembleLines([text], insertNewline);
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
                strength[i] += 1.0; // p -> p
            } else {
                // p -> a/n
                if(periodPuncs.test(text[i])) {
                    strength[i] -= 1.0;
                } else {
                    strength[i] -= 0.75;
                }
            }
        } else if (alphanum.test(text[i])) {
            if (alphanum.test(text[i+1])) {
                strength[i] += 3.0;// n -> n
            } else if (isPunc[i+1]) {
                strength[i] += 1.0; // n -> p
            } else {
                // n -> a
            }
        } else {
            if (isPunc[i+1]) {
                strength[i] += 1.0; // a -> p
            } else {
                // a -> a/n
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

function assembleLines(lines: string[], insertNewline: string): string {
    let text = lines.join(insertNewline);
    return text.replace(/[！？](?!$|[！？　\s「」『』（）\(\)\\])/g, (match) => {
        return match + '　';
    });
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