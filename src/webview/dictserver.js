
function createWordElement(wordObject) {
    const wordDiv = document.createElement('div');
    wordDiv.classList.add('dict-word'); // Add a class for styling

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
            subDetailDiv.children[0].style.borderBottom = '1px solid #ddd';
        }
    });

    // Add some basic styling
    wordDiv.style.border = '1px solid #ccc';
    wordDiv.style.padding = '10px';
    wordDiv.style.marginBottom = '20px';
    wordDiv.style.borderRadius = "10px"

    // Append the main div to the body (you may need to adjust this based on your DOM structure)
    document.body.appendChild(wordDiv);
    return wordDiv
}

function createParagraph(text) {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    return paragraph;
}


function createSubDetailDiv(title) {
    const subDetailDiv = document.createElement('div');
    subDetailDiv.classList.add('sub-detail'); // Add a class for styling
    subDetailDiv.style.border = '1px solid #ddd'; // Example border styling
    subDetailDiv.style.borderRadius = '5px'; // Example border styling
    subDetailDiv.style.padding = '8px'; // Example padding styling
    subDetailDiv.style.marginBottom = '8px';
    const ex = createParagraph(`释义：${title}`)
    subDetailDiv.appendChild(ex);
    return subDetailDiv;
}

function createExampleDiv(title, trans) {
    const exampleDiv = document.createElement('div');
    exampleDiv.classList.add('example'); // Add a class for styling
    exampleDiv.style.border = '0'
    exampleDiv.style.padding = '8px'; // Example padding styling

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