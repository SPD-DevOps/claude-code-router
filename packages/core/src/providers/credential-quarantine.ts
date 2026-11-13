import fs from "node:fs";
import path from "node:path";

export const credentialQuarantineMs = 60 * 60 * 1000;

/** Durable account-wide 429 quarantine. Contains runtime IDs, never credentials. */
export class CredentialQuarantineStore {
  constructor(private readonly file: string, private readonly now: () => number = Date.now) {}

  private load(): Record<string, number> {
    try {
      const value: unknown = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value) ||
          Object.values(value).some(until => typeof until !== "number" || !Number.isFinite(until))) {
        throw new Error("Invalid credential quarantine state");
      }
      return value as Record<string, number>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error; // Never silently reuse an account when durable state is unreadable.
    }
  }

  read(key: string): { reason: string; until: number } | undefined {
    const until = this.load()[key];
    return until > this.now() ? { reason: "HTTP 429", until } : undefined;
  }

  quarantine(key: string): void {
    const now = this.now();
    const entries = Object.fromEntries(Object.entries(this.load()).filter(([, until]) => until > now));
    // Do not extend the deadline because an in-flight request also returned 429.
    entries[key] ??= now + credentialQuarantineMs;
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(entries), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }
}
