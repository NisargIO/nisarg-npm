export const TYPE_REQUEST = "q" as const;
export const TYPE_RESPONSE = "s" as const;
export const TYPE_ACK = "a" as const;
export const TYPE_STREAM_NEXT = "n" as const;
export const TYPE_STREAM_END = "d" as const;
export const TYPE_STREAM_ERROR = "x" as const;

export interface RpcRequest {
  /**
   * Type
   */
  t: typeof TYPE_REQUEST;
  /**
   * ID
   */
  i?: string;
  /**
   * Method
   */
  m: string;
  /**
   * Arguments
   */
  a: any[];
  /**
   * Optional
   */
  o?: boolean;
}
export interface RpcResponse {
  /**
   * Type
   */
  t: typeof TYPE_RESPONSE;
  /**
   * Id
   */
  i: string;
  /**
   * Result
   */
  r?: any;
  /**
   * Error
   */
  e?: any;
}

export interface RpcAck {
  /**
   * Type
   */
  t: typeof TYPE_ACK;
  /**
   * ID of the request being acknowledged
   */
  i: string;
}

export interface RpcStreamNext {
  /**
   * Type
   */
  t: typeof TYPE_STREAM_NEXT;
  /**
   * Stream ID (same as request ID)
   */
  i: string;
  /**
   * Yielded value
   */
  v: any;
}

export interface RpcStreamEnd {
  /**
   * Type
   */
  t: typeof TYPE_STREAM_END;
  /**
   * Stream ID
   */
  i: string;
}

export interface RpcStreamError {
  /**
   * Type
   */
  t: typeof TYPE_STREAM_ERROR;
  /**
   * Stream ID
   */
  i: string;
  /**
   * Error
   */
  e: any;
}

export type RpcMessage =
  | RpcRequest
  | RpcResponse
  | RpcAck
  | RpcStreamNext
  | RpcStreamEnd
  | RpcStreamError;
