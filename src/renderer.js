(async function () {
  const root = document.getElementById('root');
  const overlayMode = new URLSearchParams(location.search).get('mode') === 'overlay';
  const initialData = await window.api.getInitialData();
  let settings = initialData.settings || {};
  let stepsData = normalizeStepsData(initialData.stepsData || {});
  let selectedPresentationIndex = 0;
  let selectedCaseIndex = 0;
  let selectedIndex = 0;
  let collapsed = false;
  let clickThrough = false;
  let introductionMode = false;
  let saveTimer;
  let opacitySaveTimer;

  function normalizeStepsData(data) {
    if (Array.isArray(data.presentations) && data.presentations.length) {
      data.presentations.forEach((presentation, presentationIndex) => {
        presentation.title ||= `Presentation ${presentationIndex + 1}`;
        if (!Array.isArray(presentation.cases) || !presentation.cases.length) {
          presentation.cases = [{ id: crypto.randomUUID(), title: 'Case 1', steps: [] }];
        }
        presentation.cases.forEach((caseData, caseIndex) => {
          caseData.title ||= `Case ${caseIndex + 1}`;
          if (!Array.isArray(caseData.steps)) caseData.steps = [];
          caseData.steps.forEach(step => {
            if (!Array.isArray(step.substeps)) step.substeps = [];
          });
        });
      });
      return data;
    }
    const legacySteps = Array.isArray(data.steps) ? data.steps : [];
    legacySteps.forEach(step => {
      if (!Array.isArray(step.substeps)) step.substeps = [];
    });
    return {
      meta: data.meta || {},
      presentations: [{
        id: crypto.randomUUID(),
        title: 'Presentation 1',
        cases: [{ id: crypto.randomUUID(), title: 'Case 1', steps: legacySteps }]
      }]
    };
  }

  function activePresentation() { return stepsData.presentations[selectedPresentationIndex]; }
  function activeCase() { return activePresentation()?.cases[selectedCaseIndex]; }
  function activeSteps() { return activeCase()?.steps || []; }
  function syncState(extra = {}) {
    window.api.broadcastState({ stepsData, selectedPresentationIndex, selectedCaseIndex, selectedIndex, introductionMode, ...extra });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, className, title, action) {
    const node = el('button', className, label);
    node.type = 'button';
    if (title) { node.title = title; node.setAttribute('aria-label', title); }
    node.onclick = action;
    return node;
  }

  function toast(message) {
    document.querySelector('.toast')?.remove();
    const note = el('div', 'toast', message);
    root.appendChild(note);
    setTimeout(() => note.remove(), 2200);
  }

  function persistSteps() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await window.api.saveSteps(stepsData);
      syncState();
    }, 140);
  }

  function selectStep(index) {
    selectedIndex = Math.max(0, Math.min(index, activeSteps().length - 1));
    renderEditor();
    syncState();
  }

  function render() {
    document.body.className = overlayMode ? 'overlay-body' : '';
    if (overlayMode) renderOverlay();
    else renderEditor();
  }

  async function startPresentation(asAgenda = false) {
    introductionMode = asAgenda;
    await window.api.setOverlayMode(asAgenda ? 'agenda' : 'presentation');
    syncState();
    await window.api.startPresentation();
  }

  function renderTopbar(active) {
    const bar = el('header', 'topbar');
    const brand = el('div', 'brand');
    const brandIcon = el('img', 'brand-icon');
    brandIcon.src = './assets/presentation-note.svg';
    brandIcon.alt = 'Presentation Note icon';
    brand.append(brandIcon, el('span', '', 'Presentation Note'));
    bar.appendChild(brand);
    const nav = el('nav', 'topnav');
    [['steps', 'Steps'], ['settings', 'Settings']].forEach(([key, label]) => {
      nav.appendChild(button(label, `nav-button${active === key ? ' active' : ''}`, '', () => {
        if (key === 'settings') renderSettings(); else renderEditor();
      }));
    });
    bar.append(nav, el('div', 'top-spacer'));
    bar.appendChild(el('span', 'status', `${activeSteps().length} steps · Saved locally`));
    bar.appendChild(button('Import', 'quiet-button', 'Import steps from JSON', importSteps));
    bar.appendChild(button('Export', 'quiet-button', 'Export steps to JSON', exportSteps));
    bar.appendChild(button('Agenda', 'quiet-button', 'Present this case as an agenda', () => startPresentation(true)));
    bar.appendChild(button('Present  ›', 'primary-button', 'Start presentation mode', () => startPresentation(false)));
    root.appendChild(bar);
  }

  function renderEditor() {
    root.replaceChildren();
    renderTopbar('steps');
    const workspace = el('main', 'workspace');
    const rail = el('aside', 'step-rail');
    const heading = el('div', 'rail-heading');
    heading.append(el('span', 'eyebrow', 'Presentation steps'), el('span', 'step-count', String(activeSteps().length).padStart(2, '0')));
    rail.appendChild(heading);
    const hierarchy = el('div', 'hierarchy-controls');
    const presentationRow = el('div', 'hierarchy-row');
    const presentationSelect = document.createElement('select');
    presentationSelect.className = 'hierarchy-select';
    presentationSelect.setAttribute('aria-label', 'Presentation');
    stepsData.presentations.forEach((presentation, index) => {
      const option = el('option', '', presentation.title);
      option.value = String(index);
      presentationSelect.appendChild(option);
    });
    presentationSelect.value = String(selectedPresentationIndex);
    presentationSelect.onchange = () => selectPresentation(Number(presentationSelect.value));
    presentationRow.appendChild(el('span', 'hierarchy-label', 'Presentation'));
    presentationRow.appendChild(presentationSelect);
    presentationRow.append(
      button('+', 'hierarchy-action', 'Add presentation', addPresentation),
      button('×', 'hierarchy-action', 'Remove presentation', removePresentation)
    );
    hierarchy.appendChild(presentationRow);

    const caseRow = el('div', 'hierarchy-row');
    const caseSelect = document.createElement('select');
    caseSelect.className = 'hierarchy-select';
    caseSelect.setAttribute('aria-label', 'Case');
    activePresentation().cases.forEach((caseData, index) => {
      const option = el('option', '', caseData.title);
      option.value = String(index);
      caseSelect.appendChild(option);
    });
    caseSelect.value = String(selectedCaseIndex);
    caseSelect.onchange = () => selectCase(Number(caseSelect.value));
    caseRow.appendChild(el('span', 'hierarchy-label', 'Case'));
    caseRow.appendChild(caseSelect);
    caseRow.append(
      button('+', 'hierarchy-action', 'Add case', addCase),
      button('×', 'hierarchy-action', 'Remove case', removeCase)
    );
    hierarchy.appendChild(caseRow);
    rail.appendChild(hierarchy);

    const parentNames = el('div', 'hierarchy-names');
    const presentationName = makeParentNameField('Presentation name', presentationSelect.value ? activePresentation().title : '', 'presentation');
    presentationName.input.value = activePresentation().title;
    presentationName.input.oninput = () => {
      activePresentation().title = presentationName.input.value;
      presentationSelect.options[selectedPresentationIndex].textContent = presentationName.input.value || 'Untitled presentation';
      updateEditorContextLabel();
      persistSteps();
    };
    parentNames.appendChild(presentationName.wrap);

    const caseName = makeParentNameField('Case name', activeCase().title, 'case');
    caseName.input.oninput = () => {
      activeCase().title = caseName.input.value;
      caseSelect.options[selectedCaseIndex].textContent = caseName.input.value || 'Untitled case';
      updateEditorContextLabel();
      persistSteps();
    };
    parentNames.appendChild(caseName.wrap);
    rail.appendChild(parentNames);

    const list = el('div', 'step-list');
    activeSteps().forEach((step, index) => {
      const item = el('div', `step-item${selectedIndex === index ? ' active' : ''}`);
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      item.setAttribute('aria-label', `Edit ${step.title || 'Untitled step'}`);
      item.onclick = () => selectStep(index);
      item.onkeydown = event => {
        if (event.target === item && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          selectStep(index);
        }
      };
      item.appendChild(el('span', 'step-number', String(index + 1).padStart(2, '0')));
      const copy = el('span', 'step-copy');
      copy.append(el('div', 'step-name', step.title || 'Untitled step'));
      copy.append(el('div', 'step-summary', `${(step.expectations || []).length} checkpoints`));
      item.appendChild(copy);
      if (step.important) item.appendChild(el('span', 'important-mark', '◆'));
      const removeStep = button('', 'step-delete', `Remove ${step.title || 'Untitled step'}`, event => {
        event.stopPropagation();
        deleteStepAt(index);
      });
      const trashIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      trashIcon.setAttribute('viewBox', '0 0 24 24');
      trashIcon.setAttribute('aria-hidden', 'true');
      const trashPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      trashPath.setAttribute('d', 'M3 6h18M8 6V4h8v2m2 0-1 14H7L6 6m4 4v6m4-6v6');
      trashIcon.appendChild(trashPath);
      removeStep.appendChild(trashIcon);
      item.appendChild(removeStep);
      list.appendChild(item);
    });
    rail.appendChild(list);
    const footer = el('div', 'rail-footer');
    footer.appendChild(button('+  Add a step', 'add-step', 'Add a step to the presentation', addStep));
    rail.appendChild(footer);
    workspace.appendChild(rail);

    const pane = el('section', 'editor-pane');
    const content = el('div', 'editor-content');
    const presentation = activePresentation();
    const caseData = activeCase();
    const step = activeSteps()[selectedIndex];
    const titleRow = el('div', 'editor-title-row');
    const intro = el('div');
    intro.append(el('h1', '', step ? (step.title || 'Untitled step') : 'Your presentation'),
      el('p', '', step ? `${presentation.title} / ${caseData.title} · Step ${selectedIndex + 1} of ${activeSteps().length}` : `Add steps to ${caseData.title}.`));
    titleRow.appendChild(intro);
    const actions = el('div', 'editor-actions');
    actions.append(
      button('↑', 'icon-button', 'Move step up', () => moveStep(-1)),
      button('↓', 'icon-button', 'Move step down', () => moveStep(1)),
      button('×', 'icon-button', 'Delete step', deleteStep)
    );
    titleRow.appendChild(actions);
    content.appendChild(titleRow);

    const caseTools = el('div', 'case-tools');
    caseTools.appendChild(button('Reset checkboxes', 'quiet-button', `Clear all checked expectations in ${caseData.title}`, resetCaseCheckboxes));
    content.appendChild(caseTools);

    if (step) {
      const titleField = makeField('Step title', 'input', step.title || '', 'Give this step a clear title');
      titleField.input.maxLength = 120;
      titleField.input.oninput = () => {
        step.title = titleField.input.value;
        titleRow.querySelector('h1').textContent = step.title || 'Untitled step';
        refreshStepRail();
        persistSteps();
      };
      content.appendChild(titleField.wrap);

      const contextField = makeField('Instructions', 'textarea', step.context || '', 'Describe what the presenter should do or what the audience should see.');
      contextField.input.oninput = () => { step.context = contextField.input.value; persistSteps(); };
      content.appendChild(contextField.wrap);

      const substepsHeading = el('div', 'section-heading');
      substepsHeading.append(el('h2', '', 'Sub-steps'), el('span', 'subtle', 'Shown as nested notes without checkboxes'));
      content.appendChild(substepsHeading);
      const substepList = el('div', 'substep-list');
      (step.substeps || []).forEach((substep, index) => {
        const row = el('div', 'substep-row');
        row.appendChild(el('span', 'substep-bullet', '›'));
        const input = document.createElement('input');
        input.className = 'substep-input';
        input.type = 'text';
        input.value = substep;
        input.placeholder = `Sub-step ${index + 1}`;
        input.setAttribute('aria-label', `Sub-step ${index + 1}`);
        input.oninput = () => { step.substeps[index] = input.value; persistSteps(); };
        row.appendChild(input);
        row.appendChild(button('×', 'delete-expectation', 'Remove sub-step', () => {
          step.substeps.splice(index, 1);
          persistSteps();
          renderEditor();
        }));
        substepList.appendChild(row);
      });
      content.appendChild(substepList);
      content.appendChild(button('+  Add sub-step', 'add-expectation', 'Add a sub-step', () => {
        step.substeps = step.substeps || [];
        step.substeps.push('');
        persistSteps();
        renderEditor();
        const inputs = root.querySelectorAll('.substep-input');
        inputs[inputs.length - 1]?.focus();
      }));

      const heading = el('div', 'section-heading');
      heading.append(el('h2', '', 'Checkpoints'), el('span', 'subtle', 'Mark each result during the walkthrough'));
      content.appendChild(heading);
      const expectations = el('div', 'expectation-list');
      (step.expectations || []).forEach((expectation, index) => {
        const row = el('div', 'expectation-row');
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = !!expectation.checked;
        check.setAttribute('aria-label', 'Checkpoint complete');
        check.onchange = () => { expectation.checked = check.checked; persistSteps(); };
        const label = document.createElement('input');
        label.type = 'text';
        label.value = expectation.label || '';
        label.placeholder = 'Describe an observable result';
        label.setAttribute('aria-label', 'Checkpoint description');
        label.oninput = () => { expectation.label = label.value; persistSteps(); };
        const remove = button('×', 'delete-expectation', 'Delete checkpoint', () => {
          step.expectations.splice(index, 1);
          persistSteps(); renderEditor();
        });
        row.append(check, label, remove);
        expectations.appendChild(row);
      });
      content.appendChild(expectations);
      content.appendChild(button('+  Add checkpoint', 'add-expectation', 'Add a checkpoint', () => {
        step.expectations = step.expectations || [];
        step.expectations.push({ id: crypto.randomUUID(), label: '', checked: false });
        persistSteps(); renderEditor();
        const inputs = root.querySelectorAll('.expectation-row input[type="text"]');
        inputs[inputs.length - 1]?.focus();
      }));
      const importantRow = el('div', 'setting-row');
      const important = document.createElement('input');
      important.type = 'checkbox';
      important.checked = !!step.important;
      important.onchange = () => { step.important = important.checked; persistSteps(); refreshStepRail(); };
      importantRow.append(important, el('span', 'subtle', 'Flag as important'));
      content.appendChild(importantRow);
    }
    pane.appendChild(content);
    workspace.appendChild(pane);
    root.appendChild(workspace);
    renderAttribution();
  }

  function renderAttribution() {
    const credit = el('div', 'maker-credit');
    const icon = el('img');
    icon.src = './assets/vna-logo.svg';
    icon.alt = '';
    const text = el('span');
    text.append(document.createTextNode('Made by '), el('strong', '', 'VNA'));
    credit.append(icon, text);
    root.appendChild(credit);
  }

  function makeField(label, tag, value, placeholder) {
    const wrap = el('label', 'field');
    wrap.appendChild(el('span', 'field-label', label));
    const input = document.createElement(tag);
    input.value = value;
    input.placeholder = placeholder;
    wrap.appendChild(input);
    return { wrap, input };
  }

  function makeParentNameField(label, value, name) {
    const wrap = el('label', 'hierarchy-name-field');
    wrap.appendChild(el('span', 'hierarchy-name-label', label));
    const input = document.createElement('input');
    input.className = 'hierarchy-name-input';
    input.type = 'text';
    input.value = value;
    input.placeholder = label;
    input.dataset.modelName = name;
    wrap.appendChild(input);
    return { wrap, input };
  }

  function updateEditorContextLabel() {
    const subtitle = root.querySelector('.editor-title-row p');
    if (!subtitle) return;
    const step = activeSteps()[selectedIndex];
    subtitle.textContent = step
      ? `${activePresentation().title} / ${activeCase().title} · Step ${selectedIndex + 1} of ${activeSteps().length}`
      : `Add steps to ${activeCase().title}.`;
  }

  function refreshStepRail() {
    const active = root.querySelector('.step-item.active');
    if (!active) return;
    const index = [...root.querySelectorAll('.step-item')].indexOf(active);
    const step = activeSteps()[index];
    if (!step) return;
    active.querySelector('.step-name').textContent = step.title || 'Untitled step';
    active.querySelector('.important-mark')?.remove();
    if (step.important) active.appendChild(el('span', 'important-mark', '◆'));
  }

  function selectPresentation(index) {
    selectedPresentationIndex = Math.max(0, Math.min(index, stepsData.presentations.length - 1));
    selectedCaseIndex = 0;
    selectedIndex = 0;
    renderEditor();
    syncState();
  }

  function selectCase(index) {
    selectedCaseIndex = Math.max(0, Math.min(index, activePresentation().cases.length - 1));
    selectedIndex = 0;
    renderEditor();
    syncState();
  }

  function addPresentation() {
    const presentation = { id: crypto.randomUUID(), title: `Presentation ${stepsData.presentations.length + 1}`, cases: [] };
    presentation.cases.push({ id: crypto.randomUUID(), title: 'Case 1', steps: [] });
    stepsData.presentations.push(presentation);
    selectedPresentationIndex = stepsData.presentations.length - 1;
    selectedCaseIndex = 0;
    selectedIndex = 0;
    persistSteps();
    renderEditor();
    focusModelName('presentation');
  }

  function removePresentation() {
    if (!confirm(`Remove "${activePresentation().title}" and all of its cases and steps?`)) return;
    stepsData.presentations.splice(selectedPresentationIndex, 1);
    if (!stepsData.presentations.length) {
      stepsData.presentations.push({ id: crypto.randomUUID(), title: 'Presentation 1', cases: [{ id: crypto.randomUUID(), title: 'Case 1', steps: [] }] });
    }
    selectedPresentationIndex = Math.min(selectedPresentationIndex, stepsData.presentations.length - 1);
    selectedCaseIndex = 0;
    selectedIndex = 0;
    persistSteps();
    renderEditor();
  }

  function addCase() {
    const presentation = activePresentation();
    presentation.cases.push({ id: crypto.randomUUID(), title: `Case ${presentation.cases.length + 1}`, steps: [] });
    selectedCaseIndex = presentation.cases.length - 1;
    selectedIndex = 0;
    persistSteps();
    renderEditor();
    focusModelName('case');
  }

  function focusModelName(name) {
    const input = root.querySelector(`[data-model-name="${name}"]`);
    input?.focus();
    input?.select();
  }

  function removeCase() {
    const caseData = activeCase();
    if (!confirm(`Remove "${caseData.title}" and all of its steps?`)) return;
    const cases = activePresentation().cases;
    cases.splice(selectedCaseIndex, 1);
    if (!cases.length) cases.push({ id: crypto.randomUUID(), title: 'Case 1', steps: [] });
    selectedCaseIndex = Math.min(selectedCaseIndex, cases.length - 1);
    selectedIndex = 0;
    persistSteps();
    renderEditor();
  }

  function resetCaseCheckboxes() {
    const checkedExpectations = activeSteps().flatMap(step => step.expectations || []).filter(expectation => expectation.checked);
    if (!checkedExpectations.length) {
      toast('There are no checked expectations in this case');
      return;
    }
    if (!confirm(`Reset ${checkedExpectations.length} checked expectation${checkedExpectations.length === 1 ? '' : 's'} in ${activeCase().title}?`)) return;
    checkedExpectations.forEach(expectation => { expectation.checked = false; });
    persistSteps();
    renderEditor();
    toast('Case checkboxes reset');
  }

  function addStep() {
    activeSteps().push({ id: crypto.randomUUID(), title: '', context: '', expectations: [], substeps: [], important: false });
    selectedIndex = activeSteps().length - 1;
    persistSteps();
    renderEditor();
    root.querySelector('.field input')?.focus();
  }

  function moveStep(direction) {
    const steps = activeSteps();
    const target = selectedIndex + direction;
    if (target < 0 || target >= steps.length) return;
    [steps[selectedIndex], steps[target]] = [steps[target], steps[selectedIndex]];
    selectedIndex = target;
    persistSteps();
    renderEditor();
  }

  function deleteStep() {
    deleteStepAt(selectedIndex);
  }

  function deleteStepAt(index) {
    const steps = activeSteps();
    if (index < 0 || index >= steps.length || !confirm('Delete this step and its checkpoints?')) return;
    steps.splice(index, 1);
    if (index < selectedIndex) selectedIndex--;
    selectedIndex = Math.max(0, Math.min(selectedIndex, steps.length - 1));
    persistSteps();
    renderEditor();
  }

  async function importSteps() {
    try {
      const imported = await window.api.importSteps();
      if (imported) {
        stepsData = normalizeStepsData(imported);
        selectedPresentationIndex = 0;
        selectedCaseIndex = 0;
        selectedIndex = 0;
        renderEditor();
        toast('Presentation imported');
      }
    } catch (error) { toast(error.message || 'Could not import that file'); }
  }

  async function exportSteps() {
    const result = await window.api.exportSteps();
    if (result) toast('Presentation exported');
  }

  async function renderSettings() {
    root.replaceChildren();
    renderTopbar('settings');
    const pane = el('main', 'editor-pane');
    const content = el('div', 'settings-content');
    const title = el('div', 'editor-title-row');
    const intro = el('div');
    intro.append(el('h1', '', 'Settings'), el('p', '', 'Control where your presentation lives and how you navigate it.'));
    title.appendChild(intro);
    content.appendChild(title);

    const storage = el('section', 'settings-group');
    storage.append(el('h2', '', 'Storage'), el('p', '', settings.storagePath || 'Documents / Presentation Note'));
    storage.appendChild(button('Choose folder', 'quiet-button', 'Choose a folder for your saved presentation', async () => {
      const path = await window.api.pickStorageFolder();
      if (path) {
        settings.storagePath = path;
        settings = await window.api.saveSettings({ storagePath: path });
        renderSettings();
        toast('Storage folder updated');
      }
    }));
    content.appendChild(storage);

    const hotkeys = el('section', 'settings-group');
    hotkeys.append(el('h2', '', 'Keyboard shortcuts'), el('p', '', 'Shortcuts work globally while Presentation Note is running.'));
    const defaults = await window.api.getDefaultHotkeys();
    const configured = { ...defaults, ...(settings.hotkeys || {}) };
    const grid = el('div', 'hotkey-grid');
    Object.entries(configured).forEach(([name, accelerator]) => {
      grid.appendChild(el('span', '', name.replace(/[A-Z]/g, letter => ` ${letter.toLowerCase()}`)));
      const input = document.createElement('input');
      input.className = 'setting-input';
      input.value = accelerator;
      input.dataset.name = name;
      grid.appendChild(input);
    });
    hotkeys.appendChild(grid);
    hotkeys.appendChild(button('Save shortcuts', 'quiet-button', 'Save keyboard shortcuts', async () => {
      const values = {};
      grid.querySelectorAll('input').forEach(input => { values[input.dataset.name] = input.value.trim(); });
      await window.api.saveSettings({ hotkeys: values });
      const result = await window.api.registerHotkeys(values);
      toast(result.ok ? 'Shortcuts saved' : 'Some shortcuts could not be registered');
    }));
    content.appendChild(hotkeys);

    const overlay = el('section', 'settings-group');
    overlay.append(el('h2', '', 'Presentation overlay'), el('p', '', 'Keep the current step visible above other applications.'));
    const cornerRow = el('div', 'setting-row');
    cornerRow.appendChild(el('span', 'subtle', 'Collapsed button corner'));
    const cornerSelect = document.createElement('select');
    cornerSelect.className = 'setting-input';
    [['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']].forEach(([value, label]) => {
      const option = el('option', '', label);
      option.value = value;
      cornerSelect.appendChild(option);
    });
    cornerSelect.value = settings.collapsedCorner || 'top-right';
    cornerSelect.onchange = async () => {
      settings.collapsedCorner = cornerSelect.value;
      settings = await window.api.saveSettings({ collapsedCorner: cornerSelect.value });
      syncState({ settings });
    };
    cornerRow.appendChild(cornerSelect);
    overlay.appendChild(cornerRow);
    overlay.append(el('h2', '', 'Background opacity'));
    const opacityControl = el('label', 'opacity-control');
    const opacitySlider = document.createElement('input');
    opacitySlider.type = 'range';
    opacitySlider.min = '20';
    opacitySlider.max = '100';
    opacitySlider.step = '5';
    opacitySlider.value = String(settings.overlayOpacity ?? 70);
    opacitySlider.setAttribute('aria-label', 'Presentation background opacity');
    const opacityValue = el('output', 'opacity-value', `${opacitySlider.value}%`);
    opacitySlider.oninput = () => {
      const opacity = Number(opacitySlider.value);
      settings.overlayOpacity = opacity;
      opacityValue.value = `${opacity}%`;
      opacityValue.textContent = `${opacity}%`;
      window.api.broadcastState({ settings });
      clearTimeout(opacitySaveTimer);
      opacitySaveTimer = setTimeout(async () => {
        settings = await window.api.saveSettings({ overlayOpacity: opacity });
      }, 180);
    };
    opacityControl.append(opacitySlider, opacityValue);
    overlay.appendChild(opacityControl);
    overlay.appendChild(button('Start presentation', 'primary-button', 'Hide editor and show the presentation overlay', () => startPresentation(false)));
    content.appendChild(overlay);
    pane.appendChild(content);
    root.appendChild(pane);
    renderAttribution();
  }

  function renderOverlay() {
    root.replaceChildren();
    const opacity = Number(settings.overlayOpacity ?? 70);
    document.documentElement.style.setProperty('--overlay-opacity', String(Math.min(100, Math.max(20, opacity)) / 100));
    const shell = el('main', 'overlay-shell');
    if (collapsed) {
      shell.classList.add('collapsed-shell', `corner-${settings.collapsedCorner || 'top-right'}`);
      const trigger = button('', 'collapsed-trigger', 'Expand Presentation Note', () => {});
      const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      glyph.setAttribute('viewBox', '0 0 24 24');
      glyph.setAttribute('aria-hidden', 'true');
      const glyphPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      glyphPath.setAttribute('d', 'M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4');
      glyph.appendChild(glyphPath);
      trigger.appendChild(glyph);
      attachCollapsedDrag(trigger);
      shell.appendChild(trigger);
      root.appendChild(shell);
      return;
    }

    const card = el('section', 'overlay-card');
    const head = el('header', 'overlay-head');
    head.appendChild(el('span', 'overlay-progress', `${activeSteps().length ? selectedIndex + 1 : 0} / ${activeSteps().length}`));
    const controls = el('div', 'overlay-controls');
    const modeButton = button('', 'overlay-control mode-control', introductionMode ? 'Return to current step view' : 'Show case agenda', async () => {
      const nextMode = introductionMode ? 'presentation' : 'agenda';
      await window.api.setOverlayMode(nextMode);
      introductionMode = nextMode === 'agenda';
        renderOverlay();
        syncState();
        if (introductionMode) focusAgenda();
      });
    modeButton.appendChild(makeModeIcon(introductionMode ? 'step' : 'agenda'));
    controls.append(
      modeButton,
      button('⇤', 'overlay-control', 'Back to first step', () => changeOverlayStep(-selectedIndex)),
      button('‹', 'overlay-control', 'Previous step', () => changeOverlayStep(-1)),
      button('›', 'overlay-control', 'Next step', () => changeOverlayStep(1)),
      button('↗', 'overlay-control', 'Open editor', () => window.api.focusEditor()),
      button('−', 'overlay-control', 'Collapse overlay', async () => {
        collapsed = true;
        await window.api.setOverlayCollapsed(true);
        renderOverlay();
      })
    );
    head.appendChild(controls);

    const body = el('div', 'overlay-main');
    const steps = activeSteps();
    if (introductionMode) {
      body.classList.add('agenda-main');
      body.tabIndex = -1;
      const stage = el('section', 'agenda-stage');
      const agendaHeader = el('div', 'agenda-header');
      agendaHeader.appendChild(el('h1', 'overlay-title', activePresentation()?.title || 'Presentation'));
      agendaHeader.appendChild(el('p', 'overlay-context agenda-subtitle', `${activeCase()?.title || 'Case'} · ${steps.length} steps`));
      stage.appendChild(agendaHeader);
      const agenda = el('ol', 'agenda-list');
      steps.forEach((agendaStep, index) => {
        const row = el('li', `agenda-item${index === selectedIndex ? ' active' : ''}`);
        row.tabIndex = 0;
        row.append(el('span', 'agenda-number', String(index + 1).padStart(2, '0')));
        const copy = el('span', 'agenda-copy');
        copy.append(el('strong', 'agenda-step-title', agendaStep.title || 'Untitled step'));
        if (agendaStep.context) copy.append(el('span', 'agenda-instruction', agendaStep.context));
        if (agendaStep.substeps?.length) {
          const substeps = el('ul', 'agenda-substeps');
          agendaStep.substeps.filter(Boolean).forEach(substep => substeps.appendChild(el('li', '', substep)));
          if (substeps.childElementCount) copy.appendChild(substeps);
        }
        if (agendaStep.expectations?.length) {
          const checkpoints = el('ul', 'agenda-expectations');
          agendaStep.expectations.forEach(expectation => checkpoints.appendChild(el('li', '', expectation.label || 'Checkpoint')));
          copy.appendChild(checkpoints);
        }
        row.appendChild(copy);
        row.onclick = async () => {
          await window.api.setOverlayMode('presentation');
          selectedIndex = index;
          introductionMode = false;
          renderOverlay();
          syncState();
        };
        row.onkeydown = event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            row.click();
          }
        };
        agenda.appendChild(row);
      });
      stage.appendChild(agenda);
      body.appendChild(stage);
    } else {
      const step = steps[selectedIndex];
      if (!step) body.appendChild(el('p', 'overlay-empty', 'Add a step in the editor to begin.'));
      else {
        body.appendChild(el('h1', 'overlay-title', step.title || 'Untitled step'));
        if (step.context) body.appendChild(el('p', 'overlay-context', step.context));
        if (step.substeps?.length) {
          const substepSection = el('section', 'overlay-substep-section');
          const substeps = el('ul', 'overlay-substeps');
          step.substeps.filter(Boolean).forEach(substep => substeps.appendChild(el('li', '', substep)));
          substepSection.appendChild(substeps);
          body.appendChild(substepSection);
        }
        const checks = el('div', 'overlay-checks');
        (step.expectations || []).forEach(expectation => {
          const label = el('label', 'overlay-check');
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.checked = !!expectation.checked;
          input.onchange = async () => {
            expectation.checked = input.checked;
            await window.api.saveSteps(stepsData);
            syncState();
          };
          label.append(input, document.createTextNode(expectation.label || 'Checkpoint'));
          checks.appendChild(label);
        });
        body.appendChild(checks);
      }
      const nextStep = steps[selectedIndex + 1];
      if (nextStep) {
        const preview = el('section', 'overlay-next');
        preview.appendChild(el('p', 'overlay-next-label', 'Up next'));
        preview.appendChild(el('h2', 'overlay-next-title', nextStep.title || 'Untitled step'));
        if (nextStep.context) preview.appendChild(el('p', 'overlay-next-context', nextStep.context));
        body.appendChild(preview);
      }
    }
    card.append(head, body);
    shell.appendChild(card);
    addResizeGrips(shell);
    root.appendChild(shell);
    if (introductionMode) focusAgenda();
    requestAnimationFrame(() => {
      if (collapsed || !card.isConnected) return;
      const desiredHeight = shell.clientTop + head.offsetHeight + body.scrollHeight + 48;
      window.api.fitOverlayContent(desiredHeight);
    });
  }

  function makeModeIcon(mode) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', mode === 'agenda'
      ? 'M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01'
      : 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5');
    svg.appendChild(path);
    return svg;
  }

  function focusAgenda() {
    requestAnimationFrame(() => {
      if (!overlayMode || !introductionMode) return;
      (root.querySelector('.agenda-item') || root.querySelector('.agenda-main'))?.focus();
    });
  }

  function attachCollapsedDrag(trigger) {
    let drag = null;
    trigger.addEventListener('pointerdown', async event => {
      if (event.button !== 0) return;
      event.preventDefault();
      trigger.setPointerCapture(event.pointerId);
      drag = { pointerId: event.pointerId, startPointerX: event.screenX, startPointerY: event.screenY, moved: false, bounds: null };
      const activeDrag = drag;
      activeDrag.bounds = await window.api.getOverlayBounds();
    });
    trigger.addEventListener('pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId || !drag.bounds) return;
      const deltaX = event.screenX - drag.startPointerX;
      const deltaY = event.screenY - drag.startPointerY;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 3) drag.moved = true;
      if (!drag.moved) return;
      window.api.setOverlayBounds({
        ...drag.bounds,
        x: drag.bounds.x + deltaX,
        y: drag.bounds.y + deltaY
      });
    });
    trigger.addEventListener('pointerup', async event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const wasClick = !drag.moved;
      drag = null;
      if (wasClick) {
        introductionMode = false;
        syncState();
        await window.api.setOverlayMode('presentation');
        collapsed = false;
        await window.api.setOverlayCollapsed(false);
        renderOverlay();
      }
    });
    trigger.addEventListener('pointercancel', () => { drag = null; });
  }

  function addResizeGrips(shell, minWidth = 300, minHeight = 200) {
    ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(direction => {
      const grip = el('div', `resize-grip ${direction}`);
      grip.setAttribute('aria-hidden', 'true');
      grip.addEventListener('pointerdown', async event => {
        if (event.button !== 0) return;
        event.preventDefault();
        grip.setPointerCapture(event.pointerId);
        const startPointerX = event.screenX;
        const startPointerY = event.screenY;
        const startBounds = await window.api.getOverlayBounds();
        if (!startBounds) return;
        const resize = moveEvent => {
          const deltaX = moveEvent.screenX - startPointerX;
          const deltaY = moveEvent.screenY - startPointerY;
          let { x, y, width, height } = startBounds;
          if (direction.includes('e')) width += deltaX;
          if (direction.includes('s')) height += deltaY;
          if (direction.includes('w')) {
            width = Math.max(minWidth, width - deltaX);
            x = startBounds.x + startBounds.width - width;
          }
          if (direction.includes('n')) {
            height = Math.max(minHeight, height - deltaY);
            y = startBounds.y + startBounds.height - height;
          }
          window.api.setOverlayBounds({ x, y, width: Math.max(minWidth, width), height: Math.max(minHeight, height) });
        };
        const stop = () => {
          grip.removeEventListener('pointermove', resize);
          grip.removeEventListener('pointerup', stop);
          grip.removeEventListener('pointercancel', stop);
        };
        grip.addEventListener('pointermove', resize);
        grip.addEventListener('pointerup', stop);
        grip.addEventListener('pointercancel', stop);
      });
      shell.appendChild(grip);
    });
  }

  function changeOverlayStep(direction) {
    selectedIndex = Math.max(0, Math.min(selectedIndex + direction, activeSteps().length - 1));
    renderOverlay();
    syncState();
  }

  window.api.onStateUpdate(state => {
    if (state.stepsData) stepsData = normalizeStepsData(state.stepsData);
    if (state.settings) settings = state.settings;
    if (Number.isInteger(state.selectedPresentationIndex)) selectedPresentationIndex = Math.min(state.selectedPresentationIndex, stepsData.presentations.length - 1);
    if (Number.isInteger(state.selectedCaseIndex)) selectedCaseIndex = Math.min(state.selectedCaseIndex, activePresentation().cases.length - 1);
    if (Number.isInteger(state.selectedIndex)) selectedIndex = Math.max(0, Math.min(state.selectedIndex, activeSteps().length - 1));
    if (typeof state.introductionMode === 'boolean') introductionMode = state.introductionMode;
    render();
  });

  window.api.onHotkey(name => {
    if (name === 'collapse' && overlayMode) {
      collapsed = !collapsed;
      window.api.setOverlayCollapsed(collapsed);
      renderOverlay();
    }
    if (name === 'next' || name === 'prev') {
      const direction = name === 'next' ? 1 : -1;
      selectedIndex = Math.max(0, Math.min(selectedIndex + direction, activeSteps().length - 1));
      if (overlayMode) renderOverlay();
      else renderEditor();
      syncState();
    }
    if (name === 'toggleClickThrough' && overlayMode) {
      clickThrough = !clickThrough;
      window.api.setClickThrough(clickThrough);
    }
  });

  window.addEventListener('focus', () => {
    if (overlayMode && introductionMode) focusAgenda();
  });

  if (overlayMode) window.api.setOverlayCollapsed(false);
  render();
})();
