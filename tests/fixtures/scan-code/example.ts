import { fetchData } from "./api";

function greet(name: string) {
  console.log("Hello, " + name);
  return name;
}

async function loadUser(id: string) {
  const user = await fetchData(id);
  console.log("Loaded user:", user);
  return user;
}

function processItems(items: any[]) {
  const result = items as unknown[];
  return result;
}

function cleanFunction() {
  return 42;
}
