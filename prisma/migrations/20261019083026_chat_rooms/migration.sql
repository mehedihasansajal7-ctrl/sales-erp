-- CreateEnum
CREATE TYPE "ChatRoom" AS ENUM ('OPERATION_SALES', 'OPERATION_WAREHOUSE', 'ANNOUNCEMENT');

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "room" "ChatRoom" NOT NULL,
    "body" TEXT NOT NULL,
    "order_id" TEXT,
    "delivery_order_id" TEXT,
    "mentioned_user_ids" TEXT[],
    "author_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_read_states" (
    "user_id" TEXT NOT NULL,
    "room" "ChatRoom" NOT NULL,
    "last_read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_read_states_pkey" PRIMARY KEY ("user_id","room")
);

-- CreateIndex
CREATE INDEX "chat_messages_room_created_at_idx" ON "chat_messages"("room", "created_at");

-- CreateIndex
CREATE INDEX "chat_messages_order_id_idx" ON "chat_messages"("order_id");

-- CreateIndex
CREATE INDEX "chat_messages_delivery_order_id_idx" ON "chat_messages"("delivery_order_id");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_delivery_order_id_fkey" FOREIGN KEY ("delivery_order_id") REFERENCES "delivery_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_read_states" ADD CONSTRAINT "chat_read_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
