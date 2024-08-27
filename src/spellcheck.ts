import * as vscode from 'vscode'
import * as utils from './utils'
import { getTextDelimiter } from './motion';
import axios from 'axios'; 
import { DocumentParser } from './parser';
const BAIDU_MAX_QUERY_LEN = 548;
const delayInterval = 600; //ms
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
    //console.log(`send text: [${text}]`);
    const data = {
        text: text
    };
    return axios.post(url, data, { headers }).then((value) => {
        //console.debug(value.data);
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

export function spellCheck(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration("dltxt");
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return;
    }
    const fileName = activeEditor.document.fileName;
    if(!fileName.toLocaleLowerCase().endsWith('.txt')) {
        return;
    }
    const diagnosticCollection = utils.getOrCreateDiagnosticCollection(fileName + '.spellcheck');
    if (!diagnosticCollection) {
        return;
    }
    diagnosticCollection.clear();
    const diagnostics: vscode.Diagnostic[] = [];
    

    const AK = utils.ContextHolder.getGlobalState('dltxt.config.baidu.accesskey');
    const SK = utils.ContextHolder.getGlobalState('dltxt.config.baidu.secretkey');

    if (!AK || !SK) {
        vscode.window.showErrorMessage('请先填写BaiduAPI的AccessKey和SecretKey');
        return;
    }

    let offsetMaps: [number, number, number][][] = [];


    let curDelay = 0;

    const delims = getTextDelimiter();
    vscode.window.showInformationMessage(`正在发送请求，请耐心等待`);

    const endingBracket = /[」』】）]/;

    getAccessToken(AK, SK)
    .then((accessToken) => {
        let queryString = '';
        let curMap: [number, number, number][] = []; //offset -> line_num
        let queryPromises: Promise<any>[] = [];

        DocumentParser.processTranslatedLines(activeEditor.document, (matchedGroups, c_index) => {
            if (utils.shouldSkipChecking(matchedGroups.white + matchedGroups.text + matchedGroups.suffix, delims)) {
                return;
            }
            if (queryString.length + matchedGroups.text.length + 1 >= BAIDU_MAX_QUERY_LEN) {
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
            curMap.push([c_index, queryString.length, prefixOffset]);
            queryString += matchedGroups.text;
            if (endingBracket.test(matchedGroups.suffix) 
                && !delims.test(matchedGroups.text[matchedGroups.text.length - 1])) {
                queryString += '。';
            }
        });

        if (queryString) {
            let p = delay(curDelay).then(() => {
                return make_query(queryString, accessToken);
            });
            queryPromises.push(p);
            offsetMaps.push(curMap);
        }
        return Promise.all(queryPromises);
    }, (e) => {
        vscode.window.showErrorMessage(`${e}`);
    }).then((values) => {
        const configuration = vscode.workspace.getConfiguration('dltxt');
        const skipList: string[] = configuration.get('spellingCheck.skipSet', []);
        const skipSet: Set<string> = new Set(skipList);
        let value_list = values as any[];
        for (let i = 0; i < value_list.length; i++) {
            try {
                const offsetMap = offsetMaps[i];
                const corrections = value_list[i].item.vec_fragment as any[];
                for(let j = 0; j < corrections.length; j++) {
                    if (skipSet.has(corrections[j].ori_frag)) {
                        continue;
                    }
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
        vscode.window.showInformationMessage(`检查完成，共发送${value_list.length}个请求，发现${diagnostics.length}处疑似问题`);
    }, (e) => {
        vscode.window.showErrorMessage(`${e}`);
    })
}

export function clearSpellCheck() {
    const config = vscode.workspace.getConfiguration("dltxt");
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return;
    }
    const fileName = activeEditor.document.fileName;
    if(!fileName.toLocaleLowerCase().endsWith('.txt')) {
        return;
    }
    const diagnosticCollection = utils.getOrCreateDiagnosticCollection(fileName + '.spellcheck');
    if (!diagnosticCollection) {
        return;
    }
    diagnosticCollection.clear();
}