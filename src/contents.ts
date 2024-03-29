import '@fortawesome/fontawesome-free/js/fontawesome';
import '@fortawesome/fontawesome-free/js/regular';
import '@fortawesome/fontawesome-free/js/solid';
import * as slack from './clients/slack';
import _ from 'lodash';
import {
  findCurrentEntrySeconds,
  findCurrentEntryTime,
  findDeleteEntryButtonElement,
  findEntryClient,
  findEntryProject,
  findEntryTitle,
  findEntryTitleElement,
  findTimerButtonElement,
  findTimerDivElement,
  isCounting,
} from './clients/togglUi';
import { div } from './utils/dom';
import {
  getCurrentTodoistTaskId,
  getCurrentTodoistTaskName,
  getJiraBrowserUrl,
  getSlackIncomingWebhookUrl,
  getTodoistApiToken,
  getTodoistIgnoreProjectIds,
  getTogglApiToken,
  getTogglWorkspaceId,
  setCurrentTodoistTaskEmpty,
  setCurrentTodoistTaskId,
  setCurrentTodoistTaskName,
} from './utils/storage';
import { toJapanese } from './utils/time';
import { toEmojiString, trimBracketContents } from './utils/string';
import { getClientPrefix, getEventPrefix, getProjectPrefix } from './utils/prefix';
import { Task } from './clients/todoist';
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import { findProjectId, startTimer, TogglTitle } from './clients/toggl';
import { debug } from './utils/logger';

enum Status {
  START = 'start',
  STOP = 'stop',
}

class Notifier {
  private messageQueue: string[] = [];

  async notify(builder: (title: string, client: string, project: string, time: string) => string): Promise<void> {
    const message = builder(
      await Notifier.decorate(Notifier.title()),
      Notifier.client(),
      Notifier.project(),
      Notifier.time(),
    );
    this.messageQueue.push(message);
    debug(`Pushed ${message} to queue.`);

    this.notifyToSlack();
  }

  private async notifyToSlack() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      await slack.send(await getSlackIncomingWebhookUrl(), message);
      debug(`Sent slack to ${message}`);
    }
  }

  private static title = (): string => {
    return findEntryTitle();
  };
  private static client = (): string => {
    const client = findEntryClient();
    return client ? `${getClientPrefix(client, '👥')}\`${trimBracketContents(client)}\` > ` : '';
  };
  private static project = (): string => {
    const project = findEntryProject();
    return project ? `${getProjectPrefix(project, '📂')}\`${trimBracketContents(project)}\`` : '';
  };
  private static time = (): string => `\`⏱${toJapanese(findCurrentEntryTime())}\``;

  private static decorate = async (text: string): Promise<string> =>
    `${Notifier.appendJiraLink(text, await getJiraBrowserUrl())}`;

  private static appendJiraLink(text: string, jiraBrowserUrl: string): string {
    return jiraBrowserUrl ? text.replace(/^([^-]+-[0-9]+) /, `<${jiraBrowserUrl}/$1|$1> `) : text;
  }
}

class TimerContents {
  // timer: string;
  // title: string;
  // client: string;
  // project: string;

  timerDiv: HTMLDivElement;

  // TogglのSTART/STOPボタン. Togowlでは不可視
  togglTimerButton: HTMLButtonElement;
  togglDeleteButton: HTMLButtonElement;
  togglTitleInput: HTMLInputElement;

  startButton: HTMLDivElement;
  pauseButton: HTMLDivElement;
  interruptButton: HTMLDivElement;
  doneButton: HTMLDivElement;
  deleteButton: HTMLDivElement;

  todoistButton: HTMLDivElement;

  timerButtonObserver: MutationObserver;
  titleInputObserver: MutationObserver;

  /**
   * インスタンス生成の準備ができているかどうか
   */
  static readyToCreate(): boolean {
    return !!findTimerDivElement();
  }

  static create(): TimerContents {
    const ins = new TimerContents();

    ins.timerDiv = findTimerDivElement();

    ins.togglTimerButton = findTimerButtonElement();
    ins.togglTitleInput = findEntryTitleElement();

    ins.startButton = this.createStartButton();
    ins.pauseButton = this.createPauseButton();
    ins.interruptButton = this.createInterruptButton();
    ins.doneButton = this.createDoneButton();
    ins.deleteButton = this.createDeleteButton();

    ins.todoistButton = this.createTodoistButton();

    ins.initLayout();

    ins.togglTimerButton.setAttribute('style', 'display: none;');

    return ins;
  }

  private initLayout() {
    this.timerDiv.appendChild(this.startButton);
    this.timerDiv.appendChild(this.pauseButton);
    this.timerDiv.appendChild(this.interruptButton);
    this.timerDiv.appendChild(this.doneButton);
    this.timerDiv.appendChild(this.deleteButton);

    this.timerDiv.appendChild(this.todoistButton);
  }

  updateVisibility(status: Status) {
    switch (status) {
      case Status.START:
        this.startButton.setAttribute('style', 'display: none;');
        this.todoistButton.setAttribute('style', 'display: none;');
        this.pauseButton.setAttribute('style', 'display: visible;');
        this.interruptButton.setAttribute('style', 'display: visible;');
        this.doneButton.setAttribute('style', 'display: visible;');
        this.deleteButton.setAttribute('style', 'display: visible;');
        break;
      case Status.STOP:
        this.startButton.setAttribute('style', 'display: visible;');
        this.todoistButton.setAttribute('style', 'display: visible;');
        this.pauseButton.setAttribute('style', 'display: none;');
        this.interruptButton.setAttribute('style', 'display: none;');
        this.doneButton.setAttribute('style', 'display: none;');
        this.deleteButton.setAttribute('style', 'display: none;');
        break;
    }
  }

  isTitleEmpty(): boolean {
    return !this.togglTitleInput.getAttribute('value');
  }

  deleteEntry() {
    findDeleteEntryButtonElement().click();
  }

  setOnClickStartButtonListener(callback: (self: this) => void): this {
    if (this.startButton) {
      this.startButton.addEventListener('click', () => callback(this));
    }
    return this;
  }

  setOnClickPauseButtonListener(callback: (self: this) => void): this {
    if (this.pauseButton) {
      this.pauseButton.addEventListener('click', () => callback(this));
    }
    return this;
  }

  setOnClickInterruptButtonListener(callback: (self: this) => void): this {
    if (this.interruptButton) {
      this.interruptButton.addEventListener('click', () => callback(this));
    }
    return this;
  }

  setOnClickDoneButtonListener(callback: (self: this) => void): this {
    if (this.doneButton) {
      this.doneButton.addEventListener('click', () => callback(this));
    }
    return this;
  }

  setOnClickDeleteButtonListener(callback: (self: this) => void): this {
    if (this.deleteButton) {
      this.deleteButton.addEventListener('click', () => callback(this));
    }
    return this;
  }

  setUpdateStatusListener(callback: (self: this, nextStatus: Status) => void): this {
    this.timerButtonObserver = new MutationObserver(e => {
      switch (e[e.length - 1].oldValue) {
        case 'Start time entry':
          callback(this, Status.START);
          break;
        case 'Stop time entry':
          callback(this, Status.STOP);
          break;
      }
    });
    this.timerButtonObserver.observe(findTimerButtonElement(), { attributes: true, attributeOldValue: true });
    callback(this, isCounting() ? Status.START : Status.STOP);
    return this;
  }

  setUpdateTitleListener(callback: (self: this) => void): this {
    this.titleInputObserver = new MutationObserver(() => callback(this));
    this.titleInputObserver.observe(this.togglTitleInput, { attributes: true });
    return this;
  }

  private static createStartButton(): HTMLDivElement {
    return div(`<i class="fas fa-play-circle fa-3x ebutton ebutton-start"></i>`, 'togowl-button-div', 'start-button');
  }

  private static createPauseButton(): HTMLDivElement {
    return div(`<i class="fas fa-pause-circle fa-3x ebutton ebutton-pause"></i>`, 'togowl-button-div');
  }

  private static createInterruptButton(): HTMLDivElement {
    return div(`<i class="fas fa-exclamation-circle fa-3x ebutton ebutton-interrupt"></i>`, 'togowl-button-div');
  }
  private static createDoneButton(): HTMLDivElement {
    return div(`<i class="fas fa-check-circle fa-3x ebutton ebutton-done"></i>`, 'togowl-button-div');
  }
  private static createDeleteButton(): HTMLDivElement {
    return div(`<i class="fas fa-trash fa-2x ebutton ebutton-delete"></i>`, 'togowl-button-div');
  }

  private static createTodoistButton(): HTMLDivElement {
    const elem = div(
      `<img class="ebutton" src="https://cdn.svgporn.com/logos/todoist-icon.svg" />`,
      'togowl-button-div',
      'todoist-button',
    );

    const initContent = `<div style="width: 400px;">
  <i class="fas fa-circle-notch fa-spin fa-lg"></i>
  <span style="margin-left: 5px;">Loading next tasks from Todoist...</span>
</div>`;
    const task2Li = (task: Task, onClickListener): Element => {
      const elm = document.createElement('li');
      elm.setAttribute('class', 'todoist-item');
      elm.setAttribute('style', 'width: 400px;');
      elm.innerHTML = `${toEmojiString(task.title)} <span style="color: darkgrey; font-size: 80%;">${
        task.projectName
      }</span>`;
      elm.addEventListener('click', onClickListener);
      return elm;
    };

    tippy(elem, {
      theme: 'light',
      trigger: 'click',
      maxWidth: 600,
      flipOnUpdate: true,
      interactive: true,
      content: initContent,
      onShow: instance => {
        getTodoistApiToken().then(token => {
          chrome.runtime.sendMessage({ type: 'todoist.fetchDailyTasks', token: token }, async (tasks: Task[]) => {
            const divElm = document.createElement('div');
            const ul = document.createElement('ul');
            const ignoreTodoistProjectIds = await getTodoistIgnoreProjectIds();
            tasks
              .filter(task => !_.includes(ignoreTodoistProjectIds, task.projectId))
              .slice(0, 5)
              .map(task =>
                task2Li(task, async () => {
                  const projectId = await findProjectId(
                    await getTogglApiToken(),
                    await getTogglWorkspaceId(),
                    task.projectName,
                  );
                  await startTimer(await getTogglApiToken(), TogglTitle.fromTodoistTitle(task.title), projectId);
                  await setCurrentTodoistTaskId(task.id);
                  await setCurrentTodoistTaskName(task.title);
                  // TODO: プロジェクトでも判定したほうが安全
                  instance.hide();
                }),
              )
              .forEach(e => ul.appendChild(e));
            divElm.appendChild(ul);

            const cleanTodoistSyncTokenButton = div(
              `<div class="todoist-sync-token-clear-button" style="margin-top: 15px;">
  <i class="fas fa-trash"></i>
  <span style="margin-left: 5px;">Todoistのキャッシュをクリアする</span>
</div>`,
              'todoist-sync-token-clear-button-div',
            );
            cleanTodoistSyncTokenButton.addEventListener('click', () => {
              chrome.runtime.sendMessage({ type: 'todoist.clearSyncToken' }, () => {
                instance.hide();
              });
            });
            divElm.appendChild(cleanTodoistSyncTokenButton);

            instance.setContent(divElm);
          });
        });
      },
      onHidden(instance) {
        instance.setContent(initContent);
      },
    });

    return elem;
  }
}

const notifier = new Notifier();

/**
 * 初期化処理
 * @param e
 */
function init(e) {
  if (!TimerContents.readyToCreate()) {
    return;
  }
  initObserver.disconnect();

  debug('Add timer contents.');
  const contents = TimerContents.create()
    .setOnClickStartButtonListener(s => {
      debug('Start button clicked.');
      s.togglTimerButton.click();
    })
    .setOnClickPauseButtonListener(async s => {
      debug('Pause button clicked.');
      notifier.notify(
        (title, client, project, time) =>
          `${getEventPrefix().pause} \`中断\` ${time}  *${title}*    ${client}${project}`,
      );
      s.togglTimerButton.click();
    })
    .setOnClickInterruptButtonListener(async s => {
      debug('Interrupt button clicked.');
      notifier.notify(
        (title, client, project, time) => `${getEventPrefix().interrupt} \`割込発生\`:fukidashi3::doushite:`,
      );

      s.togglTimerButton.click();

      notifier.notify(
        (title, client, project, time) =>
          `　${getEventPrefix().force_stop} \`強制中断\` ${time}  *${title}*    ${client}${project}`,
      );

      setTimeout(() => s.togglTimerButton.click(), 1000);
    })
    .setOnClickDoneButtonListener(async s => {
      debug('Done button clicked.');
      notifier.notify(
        (title, client, project, time) =>
          `${getEventPrefix().done} \`完了\` ${time}  *${title}*    ${client}${project}`,
      );

      const todoistTaskName = await getCurrentTodoistTaskName();
      if (findEntryTitle() === TogglTitle.fromTodoistTitle(todoistTaskName)) {
        chrome.runtime.sendMessage(
          { type: 'todoist.closeTask', token: await getTodoistApiToken(), taskId: await getCurrentTodoistTaskId() },
          async () => {},
        );
      }
      await setCurrentTodoistTaskEmpty();

      s.togglTimerButton.click();
    })
    .setOnClickDeleteButtonListener(async s => {
      debug('Delete button clicked.');
      notifier.notify((title, client, project, time) => `${getEventPrefix().delete} \`やっぱナシ\``);
      s.deleteEntry();
    })
    .setUpdateStatusListener(async (s, status: Status) => {
      debug(`Status updated -> ${status}.`);
      s.updateVisibility(status);
      if (status == Status.START && !s.isTitleEmpty() && findCurrentEntrySeconds() < 10) {
        notifier.notify(
          (title, client, project, time) => `${getEventPrefix().start} \`開始\`  *${title}*    ${client}${project}`,
        );
      }
    });
}

const initObserver = new MutationObserver(init);
initObserver.observe(document.body, { childList: true });
