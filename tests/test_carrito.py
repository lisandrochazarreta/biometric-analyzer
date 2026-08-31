"""Tests sin red: parseo de VTEX, carrito, firmas de webhook y loop del agente."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from carrito import whatsapp, vtex
from carrito.agent import ShoppingAgent, fmt_money
from carrito.config import Config
from carrito.storage import CartItem, Storage
from carrito.stores import Store, load_stores, resolve

STORE = Store(key="test", name="Test Market", host="tienda.test")

CATALOG_RESPONSE = [
    {
        "productId": "100",
        "productName": "Leche Entera La Serenísima 1L",
        "brand": "La Serenísima",
        "linkText": "leche-entera-1l",
        "items": [
            {
                "itemId": "555",
                "nameComplete": "Leche Entera La Serenísima 1L",
                "measurementUnit": "un",
                "images": [{"imageUrl": "https://img.test/1.jpg"}],
                "sellers": [
                    {
                        "sellerId": "1",
                        "commertialOffer": {
                            "Price": 1450.5,
                            "ListPrice": 1800.0,
                            "AvailableQuantity": 12,
                        },
                    }
                ],
            }
        ],
    },
    {
        "productId": "101",
        "productName": "Leche Descremada 1L",
        "brand": "Ilolay",
        "link": "https://tienda.test/leche-descremada/p",
        "items": [
            {
                "itemId": "556",
                "nameComplete": "Leche Descremada Ilolay 1L",
                "sellers": [
                    {
                        "sellerId": "1",
                        "commertialOffer": {
                            "Price": 1200.0,
                            "ListPrice": 1200.0,
                            "AvailableQuantity": 0,
                        },
                    }
                ],
            }
        ],
    },
]


class TestVtexParsing(unittest.TestCase):
    def test_parsea_producto_disponible(self):
        p = vtex._parse_product(CATALOG_RESPONSE[0], STORE)
        self.assertIsNotNone(p)
        self.assertEqual(p.sku, "555")
        self.assertEqual(p.price, 1450.5)
        self.assertEqual(p.list_price, 1800.0)
        self.assertTrue(p.available)
        self.assertEqual(p.discount_pct, 19.0)
        self.assertEqual(p.url, "https://tienda.test/leche-entera-1l/p")

    def test_producto_sin_stock_se_parsea_pero_marca_no_disponible(self):
        p = vtex._parse_product(CATALOG_RESPONSE[1], STORE)
        self.assertIsNotNone(p)
        self.assertFalse(p.available)
        self.assertEqual(p.discount_pct, 0.0)
        self.assertEqual(p.url, "https://tienda.test/leche-descremada/p")

    def test_producto_sin_items_devuelve_none(self):
        self.assertIsNone(vtex._parse_product({"productId": "1", "items": []}, STORE))
        self.assertIsNone(vtex._parse_product("no soy un dict", STORE))

    def test_prefer_sku_elige_el_item_pedido(self):
        raw = {
            "productId": "1",
            "productName": "Yerba",
            "linkText": "yerba",
            "items": [
                {"itemId": "1", "sellers": [{"sellerId": "1", "commertialOffer": {"Price": 10, "AvailableQuantity": 5}}]},
                {"itemId": "2", "sellers": [{"sellerId": "1", "commertialOffer": {"Price": 20, "AvailableQuantity": 5}}]},
            ],
        }
        self.assertEqual(vtex._parse_product(raw, STORE, prefer_sku="2").sku, "2")

    def test_simulacion_convierte_centavos_a_pesos(self):
        sim = vtex._parse_simulation(
            {
                "value": 250050,
                "totals": [
                    {"id": "Items", "value": 300050},
                    {"id": "Discounts", "value": -50000},
                ],
                "items": [
                    {"id": "555", "availability": "available"},
                    {"id": "556", "availability": "withoutStock"},
                ],
            }
        )
        self.assertEqual(sim.total, 2500.5)
        self.assertEqual(sim.items_total, 3000.5)
        self.assertEqual(sim.discounts, -500.0)
        self.assertEqual(sim.unavailable_skus, ("556",))

    def test_cart_url_incluye_todos_los_skus(self):
        url = vtex.VtexClient.cart_url(STORE, [("555", 2, "1"), ("556", 1, "2")])
        self.assertTrue(url.startswith("https://tienda.test/checkout/cart/add?"))
        self.assertIn("sku=555&qty=2&seller=1", url)
        self.assertIn("sku=556&qty=1&seller=2", url)
        self.assertTrue(url.endswith("sc=1"))


class TestStores(unittest.TestCase):
    def test_defaults_incluyen_coto_y_alternativas(self):
        stores = load_stores(None)
        self.assertIn("coto", stores)
        self.assertIn("jumbo", stores)
        self.assertIn("carrefour", stores)

    def test_resolve_por_key_y_por_nombre(self):
        stores = load_stores(None)
        self.assertEqual(resolve(stores, "COTO").key, "coto")
        self.assertEqual(resolve(stores, "Jumbo").key, "jumbo")
        self.assertIsNone(resolve(stores, "walmart de marte"))

    def test_stores_file_sobreescribe_y_agrega(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "stores.json"
            f.write_text('{"coto": {"host": "otro.coto.com.ar"}, "nuevo": {"host": "n.test", "name": "Nuevo"}}')
            stores = load_stores(f)
            self.assertEqual(stores["coto"].host, "otro.coto.com.ar")
            self.assertEqual(stores["nuevo"].name, "Nuevo")


class TestStorage(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.st = Storage(Path(self._dir.name) / "db.sqlite")

    def tearDown(self):
        self.st.close()
        self._dir.cleanup()

    def _item(self, sku="555", qty=1, price=100.0):
        return CartItem(sku=sku, qty=qty, name="Leche", brand="LS", price=price, seller="1", url="")

    def test_agregar_suma_cantidad_del_mismo_sku(self):
        self.st.add_item("+54911", "coto", self._item(qty=2))
        item = self.st.add_item("+54911", "coto", self._item(qty=3))
        self.assertEqual(item.qty, 5)
        self.assertEqual(len(self.st.get_cart("+54911", "coto")), 1)

    def test_carritos_separados_por_tienda(self):
        self.st.add_item("+54911", "coto", self._item())
        self.assertEqual(self.st.get_cart("+54911", "jumbo"), [])

    def test_set_qty_cero_elimina(self):
        self.st.add_item("+54911", "coto", self._item())
        self.assertTrue(self.st.set_qty("+54911", "coto", "555", 0))
        self.assertEqual(self.st.get_cart("+54911", "coto"), [])
        self.assertFalse(self.st.set_qty("+54911", "coto", "999", 1))

    def test_historial_arranca_siempre_con_user(self):
        self.st.get_store("+54911", "coto")
        self.st.set_history(
            "+54911",
            [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"},
             {"role": "user", "content": "c"}, {"role": "assistant", "content": "d"}],
            max_messages=3,
        )
        h = self.st.get_history("+54911")
        self.assertEqual(h[0]["role"], "user")
        self.assertEqual(len(h), 2)

    def test_dedupe_de_webhooks(self):
        self.assertTrue(self.st.mark_processed("SM1"))
        self.assertFalse(self.st.mark_processed("SM1"))


class TestWhatsAppHelpers(unittest.TestCase):
    def test_normalize_number(self):
        self.assertEqual(whatsapp.normalize_number("whatsapp:+5491133334444"), "+5491133334444")
        self.assertEqual(whatsapp.normalize_number("5491133334444"), "+5491133334444")

    def test_split_message_respeta_el_limite(self):
        text = "\n".join(f"linea numero {i}" for i in range(200))
        chunks = whatsapp.split_message(text, 200)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(c) <= 200 for c in chunks))
        self.assertIn("linea numero 199", chunks[-1])

    def test_split_message_texto_corto(self):
        self.assertEqual(whatsapp.split_message("hola", 100), ["hola"])
        self.assertEqual(whatsapp.split_message("  ", 100), [])

    def test_firma_de_twilio(self):
        # Vectores generados con twilio.request_validator.RequestValidator
        # (librería oficial) y comparados contra esta implementación.
        p = whatsapp.TwilioProvider("AC", "12345", "+14155238886")
        self.assertEqual(
            p.expected_signature(
                "https://mycompany.com/myapp.php?foo=1&bar=2",
                {
                    "Digits": "1234",
                    "To": "+18005551212",
                    "From": "+14158675310",
                    "Caller": "+14158675310",
                    "CallSid": "CA1234567890ABCDE",
                },
            ),
            "GvWf1cFY/Q7PnoempGyD5oXAezc=",
        )
        self.assertEqual(
            p.expected_signature(
                "https://midominio.ngrok.app/webhook/twilio",
                {
                    "From": "whatsapp:+5491133334444",
                    "Body": "hola, quiero leche",
                    "MessageSid": "SM123",
                    "NumMedia": "0",
                },
            ),
            "a+YhC7oQuPOHtPdaZ0c1noTbmhs=",
        )

    def test_verify_rechaza_firma_mala(self):
        p = whatsapp.TwilioProvider("AC", "12345", "+1")
        self.assertFalse(p.verify(url="https://x/y", body=b"", form={}, headers={"x-twilio-signature": "nope"}))

    def test_meta_parsea_mensaje_de_texto(self):
        p = whatsapp.MetaProvider("tok", "123")
        msgs = p.parse(
            body=b"",
            form={},
            json_body={
                "entry": [{"changes": [{"value": {"messages": [
                    {"from": "5491133334444", "id": "wamid.1", "type": "text", "text": {"body": "hola"}}
                ]}}]}]
            },
        )
        self.assertEqual(len(msgs), 1)
        self.assertEqual(msgs[0].user_id, "+5491133334444")
        self.assertEqual(msgs[0].text, "hola")

    def test_meta_marca_no_texto_como_unsupported(self):
        p = whatsapp.MetaProvider("tok", "123")
        msgs = p.parse(
            body=b"", form={},
            json_body={"entry": [{"changes": [{"value": {"messages": [
                {"from": "5491133334444", "id": "wamid.2", "type": "audio"}
            ]}}]}]},
        )
        self.assertEqual(msgs[0].kind, "unsupported")


# --------------------------------------------------------- agente (con stubs)


class _Block(SimpleNamespace):
    def model_dump(self, **_kwargs):
        return {k: v for k, v in self.__dict__.items()}


def text_block(t):
    return _Block(type="text", text=t)


def tool_block(tid, name, args):
    return _Block(type="tool_use", id=tid, name=name, input=args)


class _FakeMessages:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self._responses.pop(0)


class _FakeAnthropic:
    def __init__(self, responses):
        self.messages = _FakeMessages(responses)
        # El agente prueba primero la ruta beta con fallbacks; la hacemos fallar
        # una vez para ejercitar el degradado a client.messages.create.
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._beta_create))

    def _beta_create(self, **_kwargs):
        raise TypeError("fallbacks no soportado en este stub")


class _FakeVtex:
    def __init__(self, products):
        self.products = products
        self.simulated = None

    def search(self, store, term, limit=6):
        return [p for p in self.products if term.lower().split()[0] in p.name.lower()][:limit]

    def get_by_sku(self, store, sku):
        return next((p for p in self.products if p.sku == sku), None)

    def simulate(self, store, items, postal_code):
        self.simulated = list(items)
        return vtex.Simulation(total=2500.5, items_total=3000.5, discounts=-500.0, unavailable_skus=())

    @staticmethod
    def cart_url(store, items):
        return vtex.VtexClient.cart_url(store, items)


class TestAgent(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.cfg = Config(db_path=Path(self._dir.name) / "db.sqlite", default_store="coto")
        self.storage = Storage(self.cfg.db_path)
        self.products = [
            vtex._parse_product(CATALOG_RESPONSE[0], STORE),
            vtex._parse_product(CATALOG_RESPONSE[1], STORE),
        ]
        self.fake_vtex = _FakeVtex(self.products)

    def tearDown(self):
        self.storage.close()
        self._dir.cleanup()

    def _agent(self, responses):
        return ShoppingAgent(
            self.cfg, self.storage, vtex=self.fake_vtex, client=_FakeAnthropic(responses)
        )

    def test_loop_ejecuta_herramientas_y_devuelve_texto_final(self):
        agent = self._agent([
            SimpleNamespace(
                stop_reason="tool_use",
                content=[tool_block("t1", "buscar_producto", {"consulta": "leche"})],
            ),
            SimpleNamespace(
                stop_reason="tool_use",
                content=[tool_block("t2", "agregar_al_carrito", {"sku": "555", "cantidad": 2})],
            ),
            SimpleNamespace(stop_reason="end_turn", content=[text_block("Listo, agregué 2 leches.")]),
        ])
        reply = agent.handle("+54911", "quiero 2 leches")
        self.assertEqual(reply, "Listo, agregué 2 leches.")
        cart = self.storage.get_cart("+54911", "coto")
        self.assertEqual(len(cart), 1)
        self.assertEqual(cart[0].qty, 2)
        self.assertEqual(cart[0].subtotal, 2901.0)

    def test_historial_guarda_solo_el_intercambio_limpio(self):
        agent = self._agent([
            SimpleNamespace(stop_reason="end_turn", content=[text_block("hola!")]),
        ])
        agent.handle("+54911", "hola")
        history = self.storage.get_history("+54911")
        self.assertEqual(
            history,
            [{"role": "user", "content": "hola"}, {"role": "assistant", "content": "hola!"}],
        )

    def test_finalizar_devuelve_link_y_total_simulado(self):
        self.storage.add_item(
            "+54911", "coto",
            CartItem(sku="555", qty=2, name="Leche", brand="LS", price=1450.5, seller="1", url=""),
        )
        agent = self._agent([])
        out = agent._tool_finalizar_carrito("+54911", {})
        self.assertIn("checkout/cart/add", out)
        self.assertIn("sku=555", out)
        self.assertIn("2500.5", out)
        self.assertEqual(self.fake_vtex.simulated, [("555", 2, "1")])

    def test_finalizar_con_carrito_vacio_avisa(self):
        agent = self._agent([])
        self.assertIn("vac", agent._tool_finalizar_carrito("+54911", {}))

    def test_agregar_sku_inexistente_devuelve_error_no_excepcion(self):
        agent = self._agent([])
        out = agent._dispatch("+54911", "agregar_al_carrito", {"sku": "no-existe"})
        self.assertIn("error", out)
        self.assertEqual(self.storage.get_cart("+54911", "coto"), [])

    def test_cambiar_supermercado(self):
        agent = self._agent([])
        out = agent._tool_cambiar_supermercado("+54911", {"tienda": "jumbo"})
        self.assertIn("jumbo", out)
        self.assertEqual(self.storage.get_store("+54911", "coto"), "jumbo")

    def test_cambiar_a_tienda_desconocida_no_cambia_nada(self):
        agent = self._agent([])
        agent._tool_cambiar_supermercado("+54911", {"tienda": "cotoo?"})
        self.assertEqual(self.storage.get_store("+54911", "coto"), "coto")

    def test_reset_limpia_historial(self):
        agent = self._agent([SimpleNamespace(stop_reason="end_turn", content=[text_block("hola!")])])
        agent.handle("+54911", "hola")
        agent.handle("+54911", "/reset")
        self.assertEqual(self.storage.get_history("+54911"), [])

    def test_refusal_no_rompe(self):
        agent = self._agent([SimpleNamespace(stop_reason="refusal", content=[], stop_details=None)])
        self.assertIn("no puedo", agent.handle("+54911", "algo raro"))

    def test_corta_el_loop_si_el_modelo_no_para(self):
        responses = [
            SimpleNamespace(
                stop_reason="tool_use",
                content=[tool_block(f"t{i}", "ver_carrito", {})],
            )
            for i in range(self.cfg.max_tool_iterations)
        ]
        agent = self._agent(responses)
        self.assertIn("enredando", agent.handle("+54911", "loop"))


class TestFormato(unittest.TestCase):
    def test_formato_de_plata_argentino(self):
        self.assertEqual(fmt_money(1234.5), "$1.234,50")
        self.assertEqual(fmt_money(999), "$999,00")
        self.assertEqual(fmt_money(1234567.89), "$1.234.567,89")


if __name__ == "__main__":
    unittest.main()


class TestMetaChallenge(unittest.TestCase):
    def test_challenge_ok_y_token_malo(self):
        p = whatsapp.MetaProvider("tok", "123", verify_token="secreto")
        self.assertEqual(
            p.challenge({"hub.mode": "subscribe", "hub.verify_token": "secreto", "hub.challenge": "42"}),
            "42",
        )
        self.assertIsNone(
            p.challenge({"hub.mode": "subscribe", "hub.verify_token": "otro", "hub.challenge": "42"})
        )
