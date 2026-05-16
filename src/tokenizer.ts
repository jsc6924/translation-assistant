
type TokenizerModule = {
    load: (options?: unknown) => unknown;
    cut: (text: string, hmm?: boolean) => string[];
};

type SegmentitToken = string | { w: string };

type SegmentitInstance = {
    doSegment: (text: string) => SegmentitToken[];
};

type SegmentitModule = {
    Segment: new () => SegmentitInstance;
    useDefault: (segment: SegmentitInstance) => SegmentitInstance;
};

let tokenizerModule: TokenizerModule | undefined;

function createLoadError(library: string, error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);

    return new Error(
        `Failed to load ${library} on ${process.platform}: ${message}. ` +
        `Verify segmentit is installed and bundled into out/main.js.`
    );
}

function createSegmentitTokenizer(): TokenizerModule {
    try {
        const { Segment, useDefault } = require('segmentit') as SegmentitModule;
        let segmenter: SegmentitInstance | undefined;

        function load(): SegmentitInstance {
            if (!segmenter) {
                segmenter = useDefault(new Segment());
            }
            return segmenter;
        }

        return {
            load,
            cut(text: string): string[] {
                return load()
                    .doSegment(text)
                    .map((token) => typeof token === 'string' ? token : token.w)
                    .filter((token) => token.length > 0);
            }
        };
    } catch (error) {
        throw createLoadError('segmentit', error);
    }
}

export function getChineseTokenizer(): TokenizerModule {
    if (tokenizerModule) {
        return tokenizerModule;
    }

    tokenizerModule = createSegmentitTokenizer();

    return tokenizerModule;
}

export function ensureChineseTokenizerLoaded(): TokenizerModule {
    const tokenizer = getChineseTokenizer();
    tokenizer.load();
    return tokenizer;
}