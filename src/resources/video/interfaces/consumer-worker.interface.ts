export interface ConsumerWorker {
  pauseWorker(): Promise<void>;
  resumeWorker(): void;
  closeWorker(): Promise<void>;
}