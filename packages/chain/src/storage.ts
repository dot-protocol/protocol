import type { DOT } from '@dot-protocol/core';

/** Pluggable storage backend for a DOT chain. */
export interface IChainStorage {
  append(dot: DOT): Promise<void> | void;
  getAll(): Promise<DOT[]> | DOT[];
  getHead(): Promise<DOT | undefined> | DOT | undefined;
  length(): Promise<number> | number;
  clear(): Promise<void> | void;
}

/** In-memory storage. Default backend. Not persistent. */
export class MemoryStorage implements IChainStorage {
  private dots: DOT[] = [];

  append(dot: DOT): void {
    this.dots.push(dot);
  }

  getAll(): DOT[] {
    return [...this.dots];
  }

  getHead(): DOT | undefined {
    return this.dots[this.dots.length - 1];
  }

  length(): number {
    return this.dots.length;
  }

  clear(): void {
    this.dots = [];
  }
}
