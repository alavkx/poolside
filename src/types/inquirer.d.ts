// Type definitions for inquirer
// These are external library types that require 'any' for compatibility

declare module "inquirer" {
  interface QuestionBase {
    name: string;
    message: string;
    // biome-ignore lint/suspicious/noExplicitAny: External library type definition
    default?: any;
  }

  interface InputQuestion extends QuestionBase {
    type: "input";
    // biome-ignore lint/suspicious/noExplicitAny: External library type definition
    validate?: (input: any) => boolean | string | Promise<boolean | string>;
  }

  interface PasswordQuestion extends QuestionBase {
    type: "password";
  }

  interface ConfirmQuestion extends QuestionBase {
    type: "confirm";
  }

  interface ListQuestion extends QuestionBase {
    type: "list";
    // biome-ignore lint/suspicious/noExplicitAny: External library type definition
    choices: Array<{ name: string; value: any }> | string[];
    // biome-ignore lint/suspicious/noExplicitAny: External library type definition
    default?: any;
  }

  type Question =
    | InputQuestion
    | PasswordQuestion
    | ConfirmQuestion
    | ListQuestion;

  interface Inquirer {
    // biome-ignore lint/suspicious/noExplicitAny: External library type definition
    prompt(questions: Question[]): Promise<any>;
  }

  const inquirer: Inquirer;
  export default inquirer;
}
