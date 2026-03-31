import type { HandlerDef } from "./handler";

interface CommandRegistrar {
  _registerCommand(target: object, propertyKey: string, describe?: string): void;
}

export function command(describe?: string) {
  return function <This extends object>(
    _value: undefined,
    context: ClassFieldDecoratorContext<This, HandlerDef>,
  ): void {
    if (context.static) {
      throw new Error("@command can only be used on instance fields");
    }

    if (context.private) {
      throw new Error("@command cannot be used on private fields");
    }

    context.addInitializer(function () {
      (this.constructor as unknown as CommandRegistrar)._registerCommand(
        this,
        String(context.name),
        describe,
      );
    });
  };
}
