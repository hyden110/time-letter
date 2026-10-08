/** 可注入时钟：业务代码不直接 new Date()，保证测试可复现 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
