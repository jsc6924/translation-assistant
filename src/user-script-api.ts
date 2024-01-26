import { getRegex } from './formatter';

export function contains(line: string, what: string): boolean {
    if (what === undefined) {
        return false;
    }
    const reg = new RegExp(what);
    if (reg.test(line)) {
        return true;
    }
    return false;
}

export function clear(target: string, what: string): string {
    let res = '';
    for (const c of target) {
        if (!contains(c, what)) {
            res += c;
        }
    }
    return res;
}

export function clearExcept(target: string, except: string): string {
    let res = '';
    for (const c of target) {
        if (contains(c, except)) {
            res += c;
        }
    }
    return res;
}

export { getRegex };