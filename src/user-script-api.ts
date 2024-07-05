import { getRegex } from './parser';
import { channel } from './dlbuild';
import * as fs from 'fs';
import * as path from 'path';
import {encodeWithBom} from './encoding';

export { fs, path };

export { encodeWithBom };

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

export function log(msg: string) {
    channel.appendLine('[user-log]' + msg);
    channel.show();
}

export { getRegex };