import {create} from 'zustand';
import type {
  OpenWebViewOptions,
  OpenWebViewResult,
} from '../providers/types';

/**
 * A single pending WAF-solving request.
 * Created when a provider calls `openWebView`, consumed by the
 * `WafWebViewDialog`
 */
export interface WafRequest extends OpenWebViewOptions {
  id: number;
  url: string;
  resolve: (result: OpenWebViewResult) => void;
  reject: (error: Error) => void;
}

interface WafState {
  // Pending requests. The first item is the currently displayed one.
  requests: WafRequest[];
  // Enqueue a new request and return its id.
  enqueue: (request: Omit<WafRequest, 'id'>) => number;
  // Remove a request (after it has been settled).
  remove: (id: number) => void;
}

let idCounter = 0;

/**
 * Global store used to drive the WAF WebView dialog from non-React code */
export const useWafStore = create<WafState>(set => ({
  requests: [],
  enqueue: request => {
    const id = ++idCounter;
    set(state => ({requests: [...state.requests, {...request, id}]}));
    return id;
  },
  remove: id =>
    set(state => ({requests: state.requests.filter(r => r.id !== id)})),
}));
