const statusEl = document.getElementById("compra-status");
const precoEl = document.getElementById("preco-valor");
const form = document.getElementById("form-compra");
const botao = document.getElementById("btn-pagar");

function formatarBRL(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

async function carregarPreco() {
  try {
    const res = await fetch("/api/preco");
    const dados = await res.json();
    if (dados.ok) precoEl.textContent = formatarBRL(dados.preco);
  } catch {
    precoEl.textContent = "Consulte";
  }
}

form?.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  statusEl.textContent = "";
  statusEl.classList.remove("erro");
  botao.disabled = true;
  botao.textContent = "Abrindo Mercado Pago…";

  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: document.getElementById("email").value,
        nomeLoja: document.getElementById("nome-loja").value,
      }),
    });
    const dados = await res.json();
    if (!dados.ok || !dados.initPoint) {
      throw new Error(dados.mensagem || "Não foi possível iniciar o pagamento.");
    }
    window.location.href = dados.initPoint;
  } catch (erro) {
    statusEl.textContent = erro.message;
    statusEl.classList.add("erro");
    botao.disabled = false;
    botao.textContent = "Pagar com Mercado Pago";
  }
});

carregarPreco();
