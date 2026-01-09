import { create, type StateCreator } from "zustand";
import { combine } from "zustand/middleware";

export const club = {
  state: <T extends object>(initialState: T) => {
    return {
      actions: <U extends object>(actions: StateCreator<T, [], [], U>) => {
        return create(combine(initialState, actions));
      },
    };
  },
};

const RepogrepStore = club
  .state({ id: "", name: "" })
  .actions((set) => ({
    setId: (id: string) => set({ id }),
    setName: (name: string) => set({ name }),
  }));

RepogrepStore;
