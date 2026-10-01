import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../shared/exceptions/application.exception';
import { RecurrenceFrequency, type RecurrenceRuleDto } from './dto/maintenance-planning.dto';

@Injectable()
export class RecurringEngine {
  next(rule: RecurrenceRuleDto, from: Date): Date {
    this.validate(rule);
    const interval = rule.interval ?? 1;
    const next = new Date(from);
    switch (rule.frequency) {
      case RecurrenceFrequency.DAILY:
        next.setUTCDate(next.getUTCDate() + interval);
        return next;
      case RecurrenceFrequency.WEEKLY:
        next.setUTCDate(next.getUTCDate() + interval * 7);
        return next;
      case RecurrenceFrequency.MONTHLY:
        next.setUTCMonth(next.getUTCMonth() + interval);
        return next;
      case RecurrenceFrequency.YEARLY:
        next.setUTCFullYear(next.getUTCFullYear() + interval);
        return next;
      case RecurrenceFrequency.INTERVAL_DAYS:
        next.setUTCDate(next.getUTCDate() + interval);
        return next;
      case RecurrenceFrequency.INTERVAL_MONTHS:
        next.setUTCMonth(next.getUTCMonth() + interval);
        return next;
      default:
        throw this.invalid();
    }
  }

  occurrences(rule: RecurrenceRuleDto, start: Date, count: number): Date[] {
    this.validate(rule);
    const dates: Date[] = [];
    let cursor = new Date(start);
    for (let index = 0; index < count; index += 1) {
      dates.push(new Date(cursor));
      cursor = this.next(rule, cursor);
    }
    return dates;
  }

  countBefore(rule: RecurrenceRuleDto, start: Date, endExclusive: Date): number {
    this.validate(rule);
    let cursor = new Date(start);
    let count = 0;
    while (cursor < endExclusive && count < 10_000) {
      count += 1;
      cursor = this.next(rule, cursor);
    }
    return count;
  }

  occurrenceAt(rule: RecurrenceRuleDto, start: Date, executionNumber: number): Date {
    if (!Number.isInteger(executionNumber) || executionNumber < 1 || executionNumber > 10_000) {
      throw this.invalid();
    }
    return this.occurrences(rule, start, executionNumber)[executionNumber - 1];
  }

  validate(rule: RecurrenceRuleDto): void {
    if (!rule || !Object.values(RecurrenceFrequency).includes(rule.frequency)) {
      throw this.invalid();
    }
    if (
      rule.interval !== undefined &&
      (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 3650)
    ) {
      throw this.invalid();
    }
  }

  private invalid(): ApplicationException {
    return new ApplicationException(
      ERROR_CODES.MAINTENANCE_RECURRENCE_INVALID,
      'A regra de recorrência da manutenção é inválida',
      HttpStatus.BAD_REQUEST,
    );
  }
}
