const vscode = acquireVsCodeApi();
const state = JSON.parse(document.getElementById('format-config-state').textContent);
const spaceOptions = ['无效', '添加空格', '删除空格'];
const optionList = document.getElementById('option-list');
const qeSelect = document.getElementById('space-after-qe');
const newlineSelect = document.getElementById('space-after-newline');
const newlineTokenInput = document.getElementById('newline-token');
const newlineMaxLenInput = document.getElementById('newline-max-len');

function fillSelect(select, options, currentValue) {
  select.innerHTML = '';
  for (const value of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    option.selected = value === currentValue;
    select.appendChild(option);
  }
}

function createOptionRow(choice, index) {
  const row = document.createElement('div');
  row.className = 'option-row';

  const main = document.createElement('div');
  main.className = 'option-main';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = 'choice-' + index;
  checkbox.checked = !!choice.enabled;

  const label = document.createElement('label');
  label.htmlFor = checkbox.id;
  label.textContent = choice.label;

  main.appendChild(checkbox);
  main.appendChild(label);
  row.appendChild(main);

  if (choice.specifyKey && Array.isArray(choice.specifyOptions)) {
    const select = document.createElement('select');
    select.className = 'option-select';
    select.dataset.specifyKey = choice.specifyKey;
    fillSelect(select, choice.specifyOptions, choice.specifiedValue || choice.specifyOptions[0]);
    select.disabled = !checkbox.checked;
    checkbox.addEventListener('change', () => {
      select.disabled = !checkbox.checked;
    });
    row.appendChild(select);
  } else {
    row.appendChild(document.createElement('div'));
  }

  return row;
}

fillSelect(qeSelect, spaceOptions, state.spaceAfterQE);
fillSelect(newlineSelect, spaceOptions, state.spaceAfterNewline);
newlineTokenInput.value = state.newlineToken || '';
newlineMaxLenInput.value = String(state.newlineMaxLen || 24);

state.choices.forEach((choice, index) => {
  optionList.appendChild(createOptionRow(choice, index));
});

document.getElementById('cancel').addEventListener('click', () => {
  vscode.postMessage({ type: 'config-cancel' });
});

document.getElementById('submit').addEventListener('click', () => {
  const choices = state.choices.map((choice, index) => {
    const checkbox = document.getElementById('choice-' + index);
    const specifyValue = choice.specifyKey
      ? document.querySelector('select[data-specify-key="' + choice.specifyKey + '"]')?.value
      : undefined;
    return {
      configKey: choice.configKey,
      enabled: checkbox.checked,
      specifyKey: choice.specifyKey,
      specifyValue,
    };
  });

  vscode.postMessage({
    type: 'config-submit',
    payload: {
      choices,
      newlineToken: newlineTokenInput.value,
      newlineMaxLen: Number.parseInt(newlineMaxLenInput.value, 10),
      spaceAfterQE: qeSelect.value,
      spaceAfterNewline: newlineSelect.value,
    }
  });
});