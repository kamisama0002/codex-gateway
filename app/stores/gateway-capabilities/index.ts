import { FetchError } from "ofetch";
import { defineStore } from "pinia";
import type {
  AdminCapabilityCatalog,
  CapabilityCreateInput,
  CapabilityUpdateInput,
  CredentialCreateInput,
  UserCapabilityCatalog,
} from "~~/shared/types";
import { gatewayApi } from "@/utils/gateway-api";

export const useGatewayCapabilitiesStore = defineStore("gateway-capabilities", () => {
  const adminCatalog = ref<AdminCapabilityCatalog | null>(null);
  const userCatalog = ref<UserCapabilityCatalog | null>(null);
  const loading = ref(false);
  const error = ref("");
  const isAdmin = computed(() => adminCatalog.value !== null);

  async function load() {
    loading.value = true;
    error.value = "";
    try {
      adminCatalog.value = await gatewayApi<AdminCapabilityCatalog>("/api/admin/capabilities");
      userCatalog.value = null;
    } catch (caught: unknown) {
      if (!(caught instanceof FetchError) || caught.statusCode !== 403) throw caught;
      adminCatalog.value = null;
      userCatalog.value = await gatewayApi<UserCapabilityCatalog>("/api/capabilities");
    } finally {
      loading.value = false;
    }
  }

  async function createCapability(input: CapabilityCreateInput) {
    await gatewayApi("/api/admin/capabilities", { method: "POST", body: input });
    await load();
  }

  async function updateCapability(id: string, input: CapabilityUpdateInput) {
    await gatewayApi(`/api/admin/capabilities/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
    });
    await load();
  }

  async function uploadSkillArtifact(id: string, content: string) {
    await gatewayApi(`/api/admin/capabilities/${encodeURIComponent(id)}/artifact`, {
      method: "PUT",
      body: content,
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
    await load();
  }

  async function deleteCapability(id: string) {
    await gatewayApi(`/api/admin/capabilities/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await load();
  }

  async function setAssignment(
    capabilityId: string,
    input: { userId: number; projectId: number | null; assigned: boolean },
  ) {
    await gatewayApi(`/api/admin/capabilities/${encodeURIComponent(capabilityId)}/assignments`, {
      method: "POST",
      body: input,
    });
    await load();
  }

  async function createCredential(input: CredentialCreateInput) {
    await gatewayApi("/api/admin/credentials", { method: "POST", body: input });
    await load();
  }

  async function rotateCredential(id: string, secret: Record<string, string>) {
    await gatewayApi(`/api/admin/credentials/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { secret },
    });
    await load();
  }

  async function revokeCredential(id: string) {
    await gatewayApi(`/api/admin/credentials/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await load();
  }

  async function createPersonalMcp(input: CapabilityCreateInput) {
    await gatewayApi("/api/capabilities/mcp", { method: "POST", body: input });
    await load();
  }

  async function updatePersonalMcp(id: string, input: CapabilityUpdateInput) {
    await gatewayApi(`/api/capabilities/mcp/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
    });
    await load();
  }

  async function deletePersonalMcp(id: string) {
    await gatewayApi(`/api/capabilities/mcp/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await load();
  }

  async function createPersonalCredential(input: CredentialCreateInput) {
    await gatewayApi(
      `/api/capabilities/mcp/${encodeURIComponent(input.capabilityId)}/credentials`,
      { method: "POST", body: input },
    );
    await load();
  }

  async function revokePersonalCredential(capabilityId: string, credentialId: string) {
    await gatewayApi(
      `/api/capabilities/mcp/${encodeURIComponent(capabilityId)}/credentials/${encodeURIComponent(credentialId)}`,
      { method: "DELETE" },
    );
    await load();
  }

  return {
    adminCatalog,
    userCatalog,
    loading,
    error,
    isAdmin,
    load,
    createCapability,
    updateCapability,
    uploadSkillArtifact,
    deleteCapability,
    setAssignment,
    createCredential,
    rotateCredential,
    revokeCredential,
    createPersonalMcp,
    updatePersonalMcp,
    deletePersonalMcp,
    createPersonalCredential,
    revokePersonalCredential,
  };
});
