import type { AgentRuntimeDriver } from "./driver";
import type { ManagedRuntimeStatus, RuntimeStatus, RuntimeType } from "../../../shared/types";

// @ts-expect-error Runtime endpoint and persistence records are internal server contracts.
import type { ManagedRuntimeEndpoint, UserAgentRuntimeRecord } from "../../../shared/types";

declare const driver: AgentRuntimeDriver;

// @ts-expect-error Reading a conversation must include the authenticated user scope.
void driver.readConversation("conversation-1");

type ReadConversationInput = Parameters<AgentRuntimeDriver["readConversation"]>[0];
type Assert<T extends true> = T;
type _requiresUserScope = Assert<ReadConversationInput extends { userId: number } ? true : false>;
type _requiresConversationId = Assert<
  ReadConversationInput extends { conversationId: string } ? true : false
>;
type _browserStatusOmitsContainer = Assert<
  "containerId" extends keyof ManagedRuntimeStatus ? false : true
>;
type _browserStatusOmitsEndpoint = Assert<
  "websocketUrl" extends keyof ManagedRuntimeStatus ? false : true
>;
type _runtimeStatusIsPublic = Assert<RuntimeStatus extends string ? true : false>;
type _runtimeTypeIsPublic = Assert<RuntimeType extends string ? true : false>;
type _internalContractsMustRemainUnavailable = [ManagedRuntimeEndpoint, UserAgentRuntimeRecord];
