
function createWordElement(wordObject) {
    const wordDiv = document.createElement('div');
    wordDiv.classList.add('dict-word');
    wordDiv.classList.add('dict-widget');

    const spellElement = createParagraph(`${wordObject.spell}`);
    const pronElement = createParagraph(`${wordObject.pron}`);
    const accentElement = createParagraph(`${wordObject.accent}`);
    const excerptElement = createParagraph(`${wordObject.excerpt}`);

    wordDiv.appendChild(spellElement);
    wordDiv.appendChild(pronElement);
    wordDiv.appendChild(accentElement);
    wordDiv.appendChild(excerptElement);

    
    wordObject.subDetails.sort((a, b) => a.id - b.id);
    wordObject.subDetails.forEach(subDetail => {
        const subDetailDiv = createSubDetailDiv(subDetail.title);
        wordDiv.appendChild(subDetailDiv);

        subDetail.examples.forEach(example => {
            const exampleDiv = createExampleDiv(example.title, example.trans);
            subDetailDiv.appendChild(exampleDiv);
        });

        if (subDetailDiv.children.length > 1) {
            subDetailDiv.children[0].style.paddingBottom = '15px'
            subDetailDiv.children[0].style.borderBottom = '1px solid';
        }
    });

    return wordDiv
}

function createParagraph(text) {
    const paragraph = document.createElement('p');
    paragraph.classList.add('dict-widget');
    paragraph.textContent = text;
    return paragraph;
}


function createSubDetailDiv(title) {
    const subDetailDiv = document.createElement('div');
    subDetailDiv.classList.add('sub-detail');
    subDetailDiv.classList.add('dict-widget');
    const ex = createParagraph(`释义：${title}`)
    subDetailDiv.appendChild(ex);
    return subDetailDiv;
}

function createExampleDiv(title, trans) {
    const exampleDiv = document.createElement('div');
    exampleDiv.classList.add('example'); 
    exampleDiv.classList.add('dict-widget'); 

    const titleParagraph = document.createElement('p');
    titleParagraph.textContent = `例句: ${title}`;

    const transParagraph = document.createElement('p');
    transParagraph.textContent = `翻译: ${trans}`;

    exampleDiv.appendChild(titleParagraph);
    exampleDiv.appendChild(transParagraph);

    return exampleDiv;
}


document.addEventListener('DOMContentLoaded', () => {
    console.log("dom content loaded");
    const content = JSON.parse(document.getElementById('raw-data').innerText);
    console.log(content);
    const root = document.getElementById('view-root')
    const words = content['words'];
    for(const word of words) {
        root.appendChild(createWordElement(word))
    }
});