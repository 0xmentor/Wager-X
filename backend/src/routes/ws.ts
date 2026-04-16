

const wsRoutes = async (app: any) => {
  app.get("/lobby", { websocket: true }, (connection) => {
    connection.socket.send(JSON.stringify({ type: "connected", channel: "lobby" }));
  });

  app.get("/game/:id", { websocket: true }, (connection, req) => {
    const id = (req.params as { id: string }).id;
    connection.socket.send(JSON.stringify({ type: "connected", channel: `game:${id}` }));
  });
};

export default wsRoutes;
