import type { PageRequest, SortDirection } from '../../../00-shared-kernel/public';

export type FilterType = 'string' | 'integer' | 'boolean' | 'uuid' | 'date' | 'enum';

export interface FilterDefinition {
  readonly type: FilterType;
  /** Required for type "enum". */
  readonly values?: readonly string[];
  /** Accept a comma-separated list (e.g. filter[status]=a,b) and return an array. */
  readonly multiple?: boolean;
  /** For type "string" (default 100). */
  readonly maxLength?: number;
}

export type FilterValue =
  | string
  | number
  | boolean
  | readonly string[]
  | readonly number[]
  | readonly boolean[];

export interface SortSpec {
  /** Internal key (e.g. column), taken from the whitelist, never from the client. */
  readonly key: string;
  readonly direction: SortDirection;
}

/** Declares exactly what a list endpoint accepts. Everything else is rejected. */
export interface ListQuerySpec {
  /** Whitelist: public field name -> internal key. */
  readonly sortable: Readonly<Record<string, string>>;
  readonly defaultSort: readonly SortSpec[];
  /** Whitelist of filters by public name. */
  readonly filters?: Readonly<Record<string, FilterDefinition>>;
  readonly search?: { readonly maxLength?: number };
  /** Default 3. */
  readonly maxSortFields?: number;
}

export interface ListQuery {
  readonly page: PageRequest;
  readonly sort: readonly SortSpec[];
  /** Keyed by public filter name; values are validated and typed. */
  readonly filters: Readonly<Record<string, FilterValue>>;
  readonly search?: string;
}
