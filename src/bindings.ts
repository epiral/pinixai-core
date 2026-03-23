export interface Binding {
  alias: string;
  hub?: string;
  hub_token?: string;
  clip_token?: string;
}

export type Bindings = Record<string, Binding>;
