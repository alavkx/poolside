declare module 'inquirer' {
  interface QuestionBase {
    type?: string;
    name: string;
    message: string;
    default?: any;
  }

  interface ConfirmQuestion extends QuestionBase {
    type: 'confirm';
    default?: boolean;
  }

  interface InputQuestion extends QuestionBase {
    type: 'input';
    default?: string;
  }

  interface ListQuestion extends QuestionBase {
    type: 'list';
    choices: Array<{ name: string; value: any }> | string[];
    default?: any;
  }

  type Question = ConfirmQuestion | InputQuestion | ListQuestion;

  interface Inquirer {
    prompt(questions: Question[]): Promise<any>;
  }

  const inquirer: Inquirer;
  export = inquirer;
}
