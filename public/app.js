(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const form = $("product-form");
  const nameInput = $("name");
  const manufacturerInput = $("manufacturer");
  const specsInput = $("specs");
  const descriptionInput = $("description");
  const submitBtn = $("submit-btn");
  const resetBtn = $("reset-btn");
  const errorBox = $("error-box");
  const emptyState = $("empty-state");
  const resultContent = $("result-content");
  const resultActions = $("result-actions");
  const resultSubtitle = $("result-subtitle");
  const qualityBox = $("quality");
  const notesBox = $("notes");
  const output = $("output");
  const meta = $("meta");
  const copyBtn = $("copy-btn");
  const downloadBtn = $("download-btn");
  const health = $("health");

  const state = {
    tab: "markdown",
    markdown: "",
    json: "",
    result: null,
  };

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    submitBtn.querySelector(".btn-label").textContent = isLoading
      ? "Генерируем…"
      : "Сгенерировать карточку";
    submitBtn.querySelector(".spinner").hidden = !isLoading;
  }

  function formatDetails(details) {
    if (!details) return "";
    if (Array.isArray(details)) {
      return details
        .map((item) => {
          if (item && typeof item === "object") {
            return `${item.path ? `${item.path}: ` : ""}${item.message || JSON.stringify(item)}`;
          }
          return String(item);
        })
        .join("\n");
    }
    if (typeof details === "string") return details;
    return JSON.stringify(details, null, 2);
  }

  function showError(message, details) {
    const suffix = formatDetails(details);
    errorBox.textContent = suffix ? `${message}\n\n${suffix}` : message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  function parseSpecs(text) {
    const specs = {};
    const errors = [];

    text.split(/\r?\n/).forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const match = trimmed.match(/^([^:=]+)[:=](.*)$/);
      if (!match) {
        errors.push(`Строка ${index + 1}: используйте формат «параметр: значение».`);
        return;
      }

      const key = match[1].trim();
      const value = match[2].trim();

      if (!key) {
        errors.push(`Строка ${index + 1}: пустое название характеристики.`);
        return;
      }

      if (!value) {
        errors.push(`Строка ${index + 1}: пустое значение характеристики «${key}».`);
        return;
      }

      specs[key] = value;
    });

    return { specs, errors };
  }

  function addChip(text, kind) {
    const chip = document.createElement("span");
    chip.className = `chip ${kind}`;
    chip.textContent = text;
    qualityBox.appendChild(chip);
  }

  function unique(values) {
    const seen = new Set();
    return values.filter((value) => {
      const key = value.toLowerCase().replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function renderNotes(result) {
    const warnings = unique([
      ...(result.quality.warnings || []),
      ...(result.draft.missingData || []),
    ]);

    notesBox.replaceChildren();

    if (warnings.length === 0) {
      notesBox.hidden = true;
      return;
    }

    const title = document.createElement("h3");
    title.textContent = "На что обратить внимание";
    const list = document.createElement("ul");

    for (const warning of warnings) {
      const item = document.createElement("li");
      item.textContent = warning;
      list.appendChild(item);
    }

    notesBox.append(title, list);
    notesBox.hidden = false;
  }

  function renderQuality(result) {
    const quality = result.quality;
    qualityBox.replaceChildren();

    addChip(
      `Заголовок: ${quality.titleLength}/${quality.titleLimit}`,
      quality.titleWithinLimit ? "ok" : "bad",
    );
    addChip(
      `Описание: ${quality.descriptionLength}`,
      quality.descriptionWithinRange ? "ok" : "bad",
    );
    addChip(
      `Запросы: ${quality.searchQueriesCount}`,
      quality.searchQueriesWithinRange ? "ok" : "bad",
    );
    addChip(
      quality.specsWithMissingValues > 0
        ? `Характеристики: ${quality.specsCount}, без данных: ${quality.specsWithMissingValues}`
        : `Характеристики: ${quality.specsCount}`,
      quality.specsWithMissingValues > 0 ? "warn" : "ok",
    );
    addChip(
      quality.needsReview ? "Требует проверки" : "Автопроверка пройдена",
      quality.needsReview ? "warn" : "ok",
    );
  }

  function currentOutput() {
    return state.tab === "markdown" ? state.markdown : state.json;
  }

  function switchTab(tab) {
    state.tab = tab;

    document.querySelectorAll("[data-tab]").forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.tab === tab));
    });

    output.textContent = currentOutput();
  }

  function renderResult(result) {
    state.result = result;
    state.markdown = result.markdown || "";
    const forJson = { ...result };
    delete forJson.markdown;
    state.json = JSON.stringify(forJson, null, 2);

    emptyState.hidden = true;
    resultContent.hidden = false;
    resultActions.hidden = false;
    resultSubtitle.textContent = `${result.product.name}${
      result.product.manufacturer ? ` · ${result.product.manufacturer}` : ""
    }`;

    renderQuality(result);
    renderNotes(result);

    meta.textContent = `${result.meta.provider}/${result.meta.model} · попыток: ${
      result.meta.attempts
    } · ${result.meta.elapsedMs} мс · ${new Date(result.meta.generatedAt).toLocaleString("ru-RU")}`;

    switchTab(state.tab);
  }

  function clearResult() {
    state.result = null;
    state.markdown = "";
    state.json = "";
    resultContent.hidden = true;
    resultActions.hidden = true;
    emptyState.hidden = false;
    resultSubtitle.textContent = "Здесь появится черновик карточки.";
    qualityBox.replaceChildren();
    notesBox.hidden = true;
    output.textContent = "";
    meta.textContent = "";
  }

  async function loadSample(file, button) {
    clearError();

    try {
      const response = await fetch(`/samples/${file}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      nameInput.value = data.name || "";
      manufacturerInput.value = data.manufacturer || "";
      specsInput.value = Object.entries(data.specs || {})
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n");
      descriptionInput.value = data.description || "";

      document.querySelectorAll(".sample-btn").forEach((item) => {
        item.classList.toggle("active", item === button);
      });

      clearResult();
    } catch (error) {
      showError("Не удалось загрузить пример", error instanceof Error ? error.message : error);
    }
  }

  async function submit(event) {
    event.preventDefault();
    clearError();

    const name = nameInput.value.trim();
    if (!name) {
      showError("Укажите название товара — это обязательное поле.");
      nameInput.focus();
      return;
    }

    const { specs, errors } = parseSpecs(specsInput.value);
    if (errors.length > 0) {
      showError("Проверьте блок характеристик.", errors.join("\n"));
      specsInput.focus();
      return;
    }

    const payload = {
      name,
      manufacturer: manufacturerInput.value.trim(),
      specs,
      description: descriptionInput.value.trim(),
    };

    setLoading(true);

    try {
      const response = await fetch("/api/generate?include=markdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        const message = data?.error?.message || `Сервис вернул HTTP ${response.status}`;
        throw Object.assign(new Error(message), { details: data?.error?.details });
      }

      renderResult(data);
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Не удалось сгенерировать карточку",
        error instanceof Error ? error.details : undefined,
      );
    } finally {
      setLoading(false);
    }
  }

  async function copyResult() {
    const text = currentOutput();
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "Скопировано";
    } catch {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
      copyBtn.textContent = "Скопировано";
    }

    setTimeout(() => {
      copyBtn.textContent = "Копировать";
    }, 1600);
  }

  function downloadResult() {
    if (!state.result) return;

    const isMarkdown = state.tab === "markdown";
    const text = currentOutput();
    const slug = state.result.product.name
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    const blob = new Blob([text], {
      type: isMarkdown ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slug || "product-card"}.${isMarkdown ? "md" : "json"}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function checkHealth() {
    try {
      const response = await fetch("/api/health");
      const data = await response.json();

      if (data.llmConfigured) {
        health.textContent = `${data.provider} · ${data.model}`;
        health.classList.add("ok");
      } else {
        health.textContent = "LLM не настроена";
        health.classList.add("bad");
        health.title = "Добавьте GEMINI_API_KEY в .env или включите LLM_PROVIDER=mock";
      }
    } catch {
      health.textContent = "сервис недоступен";
      health.classList.add("bad");
    }
  }

  form.addEventListener("submit", submit);

  resetBtn.addEventListener("click", () => {
    form.reset();
    document.querySelectorAll(".sample-btn").forEach((item) => {
      item.classList.remove("active");
    });
    clearError();
    clearResult();
    nameInput.focus();
  });

  document.querySelectorAll(".sample-btn").forEach((button) => {
    button.addEventListener("click", () => loadSample(button.dataset.sample, button));
  });

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  copyBtn.addEventListener("click", copyResult);
  downloadBtn.addEventListener("click", downloadResult);

  checkHealth();
})();
