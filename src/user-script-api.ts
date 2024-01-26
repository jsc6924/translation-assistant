import { getRegex } from './formatter';

export function execConditionContain(line: string, what: string): boolean {
    if (what === undefined) {
        return false;
    }
    const reg = new RegExp(what);
    if (reg.test(line)) {
        return true;
    }
    return false;
}

export function execClear(target: string, except: string): string {
    let res = '';
    for (const c of target) {
        if (execConditionContain(c, except)) {
            res += c;
        }
    }
    return res;
}

export { getRegex };