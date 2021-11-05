import { StatusCode } from '../../../enums/status-code.enum';

export class ErrorMessage {
  code?: StatusCode;
  message: string;

  constructor(message: string, code?: StatusCode) {
    this.message = message;
    this.code = code;
  }
}
