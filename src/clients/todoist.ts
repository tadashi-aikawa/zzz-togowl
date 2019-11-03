import Axios, { AxiosPromise } from 'axios';
import _, { Dictionary } from 'lodash';
import dayjs from 'dayjs';

const BASE = 'https://api.todoist.com/api/v8';

namespace Api {
  export interface Project {
    id: number;
    name: string;
  }

  interface Due {
    date: string;
    is_recurring: boolean;
    lang: string;
    string: string;
  }

  export interface Task {
    id: number;
    content: string;
    day_order: number;
    parent_id: number | null;
    project_id: number | null;
    due: Due | null;
    checked: number;
  }

  export interface Root {
    items: Task[];
    projects: Project[];
  }

  export class Client {
    token: string;

    constructor(token: string) {
      this.token = token;
    }

    sync(resourceTypes: string[], syncToken: string = '*'): AxiosPromise<Root> {
      return Axios.get(
        `${BASE}/sync?sync_token=${syncToken}&resource_types=[${resourceTypes.map(x => `"${x}"`).join(',')}]`,
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
        },
      );
    }
  }
}

const REST_BASE = 'https://api.todoist.com/rest/v1';

namespace RestApi {
  export class Client {
    token: string;

    constructor(token: string) {
      this.token = token;
    }

    closeTask(taskId: number): AxiosPromise<void> {
      return Axios.post(`${REST_BASE}/tasks/${taskId}/close`, undefined, {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });
    }
  }
}

export class Task {
  constructor(
    public id: number,
    public title: string,
    public projectId: number | null,
    public projectName: string | null,
    public checked: boolean,
  ) {}
}

const toTask = (task: Api.Task, projectNameById: Dictionary<Api.Project>): Task =>
  new Task(
    task.id,
    task.content,
    task.project_id || null,
    task.project_id ? projectNameById[task.project_id].name : null,
    task.checked === 1,
  );

/**
 * 本日のタスク一覧を取得します
 * @param token Todoistトークン
 */
export async function fetchDailyTasks(token: string): Promise<Task[]> {
  const client = new Api.Client(token);
  const res: Api.Root = (await client.sync(['items', 'projects'])).data;
  const projectNameById: Dictionary<Api.Project> = _.keyBy(res.projects, x => x.id);

  const today = dayjs().format('YYYY-MM-DD');
  return _(res.items)
    .filter(x => x.due && x.due.date === today)
    .orderBy(x => x.day_order)
    .map(x => toTask(x, projectNameById))
    .reject(x => x.checked)
    .value();
}

export async function closeTask(token: string, taskId: number): Promise<void> {
  const client = new RestApi.Client(token);
  return client.closeTask(taskId).then();
}
