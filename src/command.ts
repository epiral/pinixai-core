import type { HandlerDef } from "./handler";

type CommandHost = {
  constructor: {
    _registerCommand(target: object, propertyKey: string, describe?: string): void;
  };
};

export function command(describe?: string) {
  return function (
    _value: undefined,
    context: ClassFieldDecoratorContext<CommandHost, HandlerDef>,
  ): void {
    if (context.static) {
      throw new Error("@command can only be used on instance fields");
    }

    if (context.private) {
      throw new Error("@command cannot be used on private fields");
    }

    context.addInitializer(function () {
      const constructor = this.constructor as CommandHost["constructor"];
      constructor._registerCommand(this, String(context.name), describe);
    });
  };
}
