
function createResultElement(result) {
    const resultDiv = document.createElement('div');
    resultDiv.classList.add('example');
    resultDiv.classList.add('dict-widget');
    
    const titleElement = document.createElement('div');
    titleElement.classList.add('example-title');
    titleElement.innerText = `${result.id}: ${result.fileName}`;
    titleElement.style.textAlign = 'center';
    resultDiv.appendChild(titleElement);


    for(let i = 0; i < result.jpLines.length; i++) {
        const pair = createSentencePairDiv(result.jpLines[i], result.trLines[i]);
        resultDiv.appendChild(pair);
    }
    return resultDiv
}

function createParagraph(text) {
    const paragraph = document.createElement('p');
    paragraph.classList.add('dict-widget');
    paragraph.textContent = text;
    return paragraph;
}

function createSentencePairDiv(jp, tr) {
    const pairDiv = document.createElement('div');
    pairDiv.classList.add('sentence-pair'); 
    pairDiv.classList.add('dict-widget'); 

    pairDiv.innerHTML = jp + '<br>' + tr;
    return pairDiv;
}

document.addEventListener('DOMContentLoaded', () => {
    console.log("dom content loaded");
    const content = JSON.parse(document.getElementById('raw-data').innerText);
    console.log(content);
    const root = document.getElementById('view-root')
    for(const result of content.results) {
        root.appendChild(createResultElement(result))
    }
});