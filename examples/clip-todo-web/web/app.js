const form = document.querySelector("#todo-form");
const input = document.querySelector("#todo-input");
const list = document.querySelector("#todo-list");
const summary = document.querySelector("#summary");
const status = document.querySelector("#status");
const refreshButton = document.querySelector("#refresh-button");

async function callCommand(command, input = {}) {
  const response = await fetch(`api/${command}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }

  return payload;
}

function setStatus(message, type = "info") {
  status.textContent = message;
  status.classList.toggle("error", type === "error");
}

function renderTodos(todos) {
  summary.textContent = `${todos.length} 个任务`;

  if (todos.length === 0) {
    list.innerHTML = '<li class="empty-state">当前没有待办，先添加一个试试。</li>';
    return;
  }

  list.innerHTML = todos
    .map(
      (todo) => `
        <li class="todo-item">
          <div class="todo-meta">
            <p class="todo-title">${escapeHTML(todo.title)}</p>
            <p class="todo-id">Todo #${todo.id}</p>
          </div>
          <button type="button" class="delete-button" data-id="${todo.id}">删除</button>
        </li>
      `,
    )
    .join("");
}

function escapeHTML(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function refreshTodos() {
  setStatus("正在同步任务列表...");

  try {
    const payload = await callCommand("list", {});
    renderTodos(payload.todos);
    setStatus("列表已更新。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const title = input.value.trim();

  if (!title) {
    setStatus("请输入待办标题。", "error");
    input.focus();
    return;
  }

  form.querySelector("button")?.setAttribute("disabled", "disabled");
  setStatus("正在添加待办...");

  try {
    await callCommand("add", { title });
    input.value = "";
    await refreshTodos();
    input.focus();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    form.querySelector("button")?.removeAttribute("disabled");
  }
}

async function handleListClick(event) {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest(".delete-button");

  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const id = Number(button.dataset.id);

  if (Number.isNaN(id)) {
    setStatus("无法识别要删除的任务。", "error");
    return;
  }

  button.setAttribute("disabled", "disabled");
  setStatus(`正在删除 Todo #${id}...`);

  try {
    await callCommand("delete", { id });
    await refreshTodos();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    button.removeAttribute("disabled");
  }
}

form.addEventListener("submit", handleSubmit);
list.addEventListener("click", handleListClick);
refreshButton.addEventListener("click", refreshTodos);

refreshTodos();
