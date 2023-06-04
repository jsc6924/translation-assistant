import * as vscode from 'vscode'
import * as utils from './utils'
import { getRegex, MatchedGroups } from './formatter';
import { getTextDelimiter } from './motion';
import axios from 'axios'; 
const BAIDU_MAX_QUERY_LEN = 500;

/**
 * 使用 AK，SK 生成鉴权签名（Access Token）
 * @return string 鉴权签名信息（Access Token）
 */
function getAccessToken(AK: string, SK: string): Promise<string> {
    const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${AK}&client_secret=${SK}`;

    return axios
      .post(url)
      .then(response => response.data.access_token)
      .catch(error => {
        throw error;
      });
}


function make_query(text: string, accessToken: string): Promise<any> {
    const url = `https://aip.baidubce.com/rpc/2.0/nlp/v1/ecnet?charset=UTF-8&access_token=${accessToken}`;
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
    console.log(`send text: [${text}]`);
    const data = {
        text: text
    };
    return axios.post(url, data, { headers }).then((value) => {
        console.debug(value.data);
        return Promise.resolve(value.data);
    }, (e) => {
        console.debug(`${e}`);
    });
}

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function queryLineNumber(offsetMap: [number, number, number][], offset: number): [number, number, number] {
    if (offset < 0) {
        return [-1, -1, -1];
    }
    let x = 0;
    for (let step = Math.floor(offsetMap.length/2); step > 0; step = Math.floor(step/2)) {
        while(x + step < offsetMap.length && offset >= offsetMap[x + step][1]) {
            x += step;
        }
    }
    return [offsetMap[x][0], offset - offsetMap[x][1], offsetMap[x][2]]
}

function isName(text: string, delims: RegExp) {
    return text.length <= 6 && !delims.test(text);
}

export function spellCheck(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration("dltxt");
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return;
    }
    const fileName = activeEditor.document.fileName;
    if(!fileName.endsWith('.txt')) {
        return;
    }
    const diagnosticCollection = utils.getOrCreateDiagnosticCollection(fileName + '.spellcheck');
    if (!diagnosticCollection) {
        return;
    }
    diagnosticCollection.clear();
    const diagnostics: vscode.Diagnostic[] = [];
    const [jreg, creg, oreg] = getRegex();
    if (!creg) {
        return;
    }

    const AK = config.get<string>('z.api.baidu.AccessKey');
    const SK = config.get<string>('z.api.baidu.SecretKey');

    if (!AK || !SK) {
        vscode.window.showErrorMessage('请先填写BaiduAPI的AccessKey和SecretKey');
        return;
    }

    let offsetMaps: [number, number, number][][] = [];

    const delayInterval = 1000; //ms
    let curDelay = 0;

    const delims = getTextDelimiter();

    getAccessToken(AK, SK)
    .then((accessToken) => {
        let queryString = '';
        let curMap: [number, number, number][] = []; //offset -> line_num
        let queryPromises: Promise<any>[] = [];

        // Example syntax error - checking if each line starts with a specific character
        for (let lineNumber = 0; lineNumber < activeEditor.document.lineCount; lineNumber++) {
            const lineText = activeEditor.document.lineAt(lineNumber).text;
            if (!lineText) {
                continue;
            }
            const match = creg.exec(lineText);
            if (match) {
                const matchedGroups = match.groups as any as MatchedGroups;
                if (isName(matchedGroups.text, delims)) {
                    continue;
                }
                if (queryString.length + matchedGroups.text.length >= BAIDU_MAX_QUERY_LEN) {
                    ((queryStringCopy: string) => {
                        let p = delay(curDelay).then(() => {
                            return make_query(queryStringCopy, accessToken);
                        });
                        curDelay += delayInterval;
                        queryPromises.push(p);
                    })(queryString);
                    offsetMaps.push(curMap);
                    curMap = [];
                    queryString = '';
                }
                const prefixOffset = matchedGroups.prefix.length + matchedGroups.white.length;
                curMap.push([lineNumber, queryString.length, prefixOffset]);
                queryString += matchedGroups.text;
            }
        }
        if (queryString) {
            let p = make_query(queryString, accessToken);
            queryPromises.push(p);
            offsetMaps.push(curMap);
        }
        return Promise.all(queryPromises);
    }, (e) => {
        vscode.window.showErrorMessage(`${e}`);
    }).then((values) => {
        let value_list = values as any[];
        for (let i = 0; i < value_list.length; i++) {
            try {
                const offsetMap = offsetMaps[i];
                const corrections = value_list[i].item.vec_fragment as any[];
                for(let j = 0; j < corrections.length; j++) {
                    const [lineNumber, offset, prefixLen] = queryLineNumber(offsetMap, corrections[j].begin_pos)
                    if (lineNumber == -1 || corrections[j].ori_frag === corrections[j].correct_frag) {
                        continue;
                    }
                    let len = corrections[j].end_pos - corrections[j].begin_pos;
                    if(len == 0) {
                        len = 1;
                    }
                    const range = new vscode.Range(lineNumber, prefixLen + offset,
                         lineNumber, prefixLen + offset + len);
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `疑似错别字: [${corrections[j].ori_frag}] => [${corrections[j].correct_frag}]`,
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostics.push(diagnostic);
                }
            } catch (e) {
                console.debug(e);
            }
        }
        diagnosticCollection.set(activeEditor.document.uri, diagnostics);
        vscode.window.showInformationMessage(`检查完成，发现${diagnostics.length}处疑似问题`);
    }, (e) => {
        vscode.window.showErrorMessage(`${e}`);
    })

    
}